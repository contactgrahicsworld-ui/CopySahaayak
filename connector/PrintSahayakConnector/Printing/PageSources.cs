using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using PDFtoImage;
using SkiaSharp;

namespace PrintSahayakConnector.Printing;

/// <summary>
/// Supplies printable page bitmaps one by one so large PDFs never have to be held
/// in memory all at once (render → print → dispose, page by page).
/// </summary>
public interface IPrintPageSource : IDisposable
{
    /// <summary>Number of pages that will be printed (after applying the page range).</summary>
    int PageCount { get; }

    /// <summary>Renders a 1-based page into a new bitmap (the caller disposes it).</summary>
    Bitmap RenderPage(int oneBasedPage);
}

/// <summary>
/// Renders PDF pages on demand via PDFtoImage (pdfium + Skia) at ~220 DPI and
/// applies the B/W grayscale filter when requested.
/// </summary>
public sealed class PdfPageSource : IPrintPageSource
{
    // 300 DPI: crisp text on typical 600 DPI office printers while one A4 page
    // stays ~35 MB in transient memory (rendered and disposed page by page).
    private const float RenderDpi = 300f;

    private readonly Stream _stream;
    private readonly bool _grayscale;
    private readonly int _firstPdfPage; // 0-based inclusive
    private readonly int _lastPdfPage;  // 0-based inclusive
    private bool _disposed;

    /// <summary>Opens a PDF for page-by-page rendering.</summary>
    /// <param name="pdfStream">Seekable stream with the PDF content (owned by this instance).</param>
    /// <param name="pageFrom">1-based inclusive start of the print range (null = first page).</param>
    /// <param name="pageTo">1-based inclusive end of the print range (null = last page).</param>
    /// <param name="grayscale">Render pages through the B/W luma filter.</param>
    public PdfPageSource(Stream pdfStream, int? pageFrom, int? pageTo, bool grayscale)
    {
        _stream = pdfStream;
        _grayscale = grayscale;
        _stream.Position = 0;

        var totalPages = Conversion.GetPageCount(_stream);
        _firstPdfPage = Math.Max(0, (pageFrom ?? 1) - 1);
        _lastPdfPage = Math.Min(totalPages, pageTo ?? totalPages) - 1;
        if (_lastPdfPage < _firstPdfPage)
        {
            throw new InvalidOperationException(
                $"Invalid page range {pageFrom}-{pageTo} for a {totalPages}-page document.");
        }
    }

    /// <inheritdoc />
    public int PageCount => _lastPdfPage - _firstPdfPage + 1;

    /// <inheritdoc />
    public Bitmap RenderPage(int oneBasedPage)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var pdfPage = _firstPdfPage + oneBasedPage - 1;
        if (pdfPage < _firstPdfPage || pdfPage > _lastPdfPage)
        {
            throw new ArgumentOutOfRangeException(
                nameof(oneBasedPage), $"Page {oneBasedPage} is outside the print range.");
        }

        _stream.Position = 0;
        // PDFtoImage 4.x: page (Index) + RenderOptions(Dpi) instead of the old dpiX/dpiY arguments.
        using var skBitmap = Conversion.ToImage(
            _stream,
            pdfPage,
            password: null,
            options: new RenderOptions(Dpi: (int)RenderDpi));
        var bitmap = ToGdiBitmap(skBitmap);
        return _grayscale ? GrayscaleFilter.Apply(bitmap) : bitmap;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _stream.Dispose();
    }

    /// <summary>
    /// Copies a rendered SKBitmap into a GDI+ bitmap. Always converts to BGRA8888
    /// first and copies row by row so source row padding never corrupts the image.
    /// </summary>
    private static Bitmap ToGdiBitmap(SKBitmap skBitmap)
    {
        var info = new SKImageInfo(skBitmap.Width, skBitmap.Height, SKColorType.Bgra8888, SKAlphaType.Premul);
        using var converted = new SKBitmap(info);
        // SKBitmap.ReadPixels does not exist in SkiaSharp 2.88 — read through an SKPixmap over the source.
        using var source = new SKPixmap(skBitmap.Info, skBitmap.GetPixels());
        if (!source.ReadPixels(info, converted.GetPixels(), converted.RowBytes, 0, 0))
        {
            throw new InvalidOperationException("Could not convert the rendered PDF page for printing.");
        }

        var result = new Bitmap(skBitmap.Width, skBitmap.Height, PixelFormat.Format32bppArgb);
        var data = result.LockBits(
            new Rectangle(0, 0, result.Width, result.Height),
            ImageLockMode.WriteOnly,
            PixelFormat.Format32bppArgb);
        try
        {
            var sourceBytes = converted.Bytes;
            var bytesPerRow = skBitmap.Width * 4;
            for (var row = 0; row < skBitmap.Height; row++)
            {
                Marshal.Copy(
                    sourceBytes,
                    row * converted.RowBytes,
                    IntPtr.Add(data.Scan0, row * data.Stride),
                    bytesPerRow);
            }
        }
        finally
        {
            result.UnlockBits(data);
        }

        return result;
    }
}

/// <summary>Single-page source for image documents (JPEG, PNG, …).</summary>
public sealed class ImagePageSource : IPrintPageSource
{
    private readonly Bitmap _image;
    private readonly bool _grayscale;

    /// <summary>Loads the image document fully into memory (so the temp file is not locked).</summary>
    public ImagePageSource(string filePath, bool grayscale)
    {
        _grayscale = grayscale;
        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var image = Image.FromStream(stream);
        _image = new Bitmap(image); // detached copy — the stream can be disposed
    }

    /// <inheritdoc />
    public int PageCount => 1;

    /// <inheritdoc />
    public Bitmap RenderPage(int oneBasedPage)
    {
        if (oneBasedPage != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(oneBasedPage), "Image documents have exactly one page.");
        }

        return _grayscale ? GrayscaleFilter.Apply(_image) : (Bitmap)_image.Clone();
    }

    /// <inheritdoc />
    public void Dispose() => _image.Dispose();
}
