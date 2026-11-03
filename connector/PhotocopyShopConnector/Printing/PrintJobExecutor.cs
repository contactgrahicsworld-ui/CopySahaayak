using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using PhotocopyShopConnector.Core;

namespace PhotocopyShopConnector.Printing;

/// <summary>Everything needed to print one claimed job.</summary>
/// <param name="FilePath">Full path of the downloaded document.</param>
/// <param name="MimeType">Server-provided MIME type (pdf / jpeg / png / …).</param>
/// <param name="SpoolDocumentName">
/// Name shown in the spooler queue — CRITICAL: the spooler monitor matches the job
/// by this exact name to verify completion.
/// </param>
/// <param name="PrinterName">Resolved target Windows printer.</param>
/// <param name="Copies">Number of copies (≥ 1).</param>
/// <param name="ColorMode">BW (apply grayscale), COLOR or ANY.</param>
/// <param name="PaperSize">Canonical paper size (A4/A3/…) or null for the printer default.</param>
/// <param name="Duplex">Print double sided (long-edge flip).</param>
/// <param name="PageFrom">1-based inclusive first page of the range, or null.</param>
/// <param name="PageTo">1-based inclusive last page of the range, or null.</param>
public sealed record PrintRequest(
    string FilePath,
    string MimeType,
    string SpoolDocumentName,
    string PrinterName,
    int Copies,
    string ColorMode,
    string? PaperSize,
    bool Duplex,
    int? PageFrom,
    int? PageTo);

/// <summary>Outcome of one print attempt.</summary>
/// <param name="Success">True only when the Windows spooler confirmed delivery.</param>
/// <param name="Message">Detail for the COMPLETED/FAILED event and the logs.</param>
/// <param name="Pages">Number of pages that were rendered for the job.</param>
public sealed record PrintResult(bool Success, string Message, int Pages);

/// <summary>
/// Prints a downloaded document with GDI+ (<see cref="PrintDocument"/>) and verifies
/// delivery through the Windows print spooler before reporting success. Handles
/// copies (driver copies with a software fallback), duplex, paper size, page ranges
/// and B/W grayscale conversion.
/// </summary>
public sealed class PrintJobExecutor
{
    private static readonly TimeSpan SpoolerTimeout = TimeSpan.FromSeconds(120);

    /// <summary>
    /// Runs the pipeline synchronously: snapshot queue → render → print → spooler
    /// verification. Intended to be called on a worker thread (it can block for
    /// several minutes).
    /// </summary>
    /// <param name="request">Print parameters from the claimed job.</param>
    /// <param name="onSpooling">
    /// Awaitable callback invoked right before the document is spooled — this is where
    /// the SPOOLING event is reported to the server.
    /// </param>
    /// <param name="ct">Cancellation for the spooler verification phase.</param>
    public PrintResult Execute(PrintRequest request, Func<Task>? onSpooling, CancellationToken ct)
    {
        using var source = CreatePageSource(request);
        if (source.PageCount <= 0)
        {
            return new PrintResult(false, "The document contains no printable pages.", 0);
        }

        using var document = new PrintDocument
        {
            // CRITICAL: the spooler monitor matches the queued job by this exact name.
            DocumentName = request.SpoolDocumentName,
            // Never pop the "Printing" status dialog from a headless tray application.
            PrintController = new StandardPrintController(),
        };

        var printer = document.PrinterSettings;
        printer.PrinterName = request.PrinterName;
        printer.Duplex = request.Duplex ? Duplex.Vertical : Duplex.Simplex;

        // Force the driver colour mode to match the paid job. Many Windows drivers
        // default to mono — without this a customer-paid COLOR order would silently
        // come out B/W (and a B/W order could burn colour toner).
        var wantsColor = string.Equals(request.ColorMode, "COLOR", StringComparison.OrdinalIgnoreCase);
        if (printer.SupportsColor)
        {
            document.DefaultPageSettings.Color = wantsColor;
        }

        // Use driver copies when supported; otherwise loop the pages in software.
        var driverCopies = request.Copies > 1 && printer.MaximumCopies > 1;
        if (driverCopies)
        {
            printer.Copies = (short)Math.Min(request.Copies, printer.MaximumCopies);
        }

        var paper = PaperSizeResolver.Resolve(printer, request.PaperSize);
        if (paper != null) document.DefaultPageSettings.PaperSize = paper;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

        HashSet<uint> baseline;
        try
        {
            baseline = SpoolerMonitor.GetJobs(request.PrinterName).Select(job => job.JobId).ToHashSet();
        }
        catch (Exception ex)
        {
            Logger.Warn($"Could not snapshot the spooler queue before printing: {ex.Message}");
            baseline = new HashSet<uint>();
        }

        var pageCount = source.PageCount;
        var pageIndex = 0;
        var softwareCopy = 1;
        document.PrintPage += (_, e) =>
        {
            Bitmap image;
            try
            {
                image = source.RenderPage(pageIndex + 1);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"Could not render page {pageIndex + 1}: {ex.Message}", ex);
            }

            try
            {
                DrawImageFilled(e.Graphics!, image);
            }
            finally
            {
                image.Dispose();
            }

            pageIndex++;
            if (pageIndex < pageCount)
            {
                e.HasMorePages = true;
            }
            else if (!driverCopies && softwareCopy < request.Copies)
            {
                softwareCopy++;
                pageIndex = 0;
                e.HasMorePages = true;
            }
            else
            {
                e.HasMorePages = false;
            }
        };

        // Report SPOOLING right before the job hits the spooler (order is guaranteed
        // by blocking on the callback).
        if (onSpooling != null)
        {
            try
            {
                onSpooling().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Logger.Warn($"Reporting SPOOLING failed (continuing to print): {ex.Message}");
            }
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            document.Print();
        }
        catch (Exception ex)
        {
            // Printer offline, invalid name, driver error, …
            return new PrintResult(false, $"Printing failed: {ex.Message}", 0);
        }

        Logger.Info(
            $"PrintDocument.Print() returned after {stopwatch.Elapsed.TotalSeconds:0.0}s — verifying via the print spooler.");

        var watch = SpoolerMonitor
            .WaitForCompletionAsync(request.PrinterName, request.SpoolDocumentName, baseline, SpoolerTimeout, ct)
            .GetAwaiter()
            .GetResult();

        if (!watch.Success)
        {
            return new PrintResult(false, watch.Message, 0);
        }

        return new PrintResult(
            true,
            $"Printed {pageCount} page(s) × {request.Copies} copy(ies) — {watch.Message}.",
            pageCount);
    }

    /// <summary>
    /// Draws the page image centered into the printable area, scaled to fit while
    /// preserving the aspect ratio, with high quality interpolation.
    /// </summary>
    private static void DrawImageFilled(Graphics graphics, Image image)
    {
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.CompositingQuality = CompositingQuality.HighQuality;

        // With OriginAtMargins=false the graphics origin is the printable-area corner,
        // so VisibleClipBounds is the exact area the printer can put toner on.
        var area = new RectangleF(0, 0, graphics.VisibleClipBounds.Width, graphics.VisibleClipBounds.Height);
        if (area.Width <= 0 || area.Height <= 0 || image.Width <= 0 || image.Height <= 0) return;

        var scale = Math.Min(area.Width / image.Width, area.Height / image.Height);
        var width = Math.Max(1, (int)Math.Round(image.Width * scale));
        var height = Math.Max(1, (int)Math.Round(image.Height * scale));
        var destination = new Rectangle(
            (int)(area.X + (area.Width - width) / 2),
            (int)(area.Y + (area.Height - height) / 2),
            width,
            height);
        graphics.DrawImage(image, destination, 0, 0, image.Width, image.Height, GraphicsUnit.Pixel);
    }

    private static IPrintPageSource CreatePageSource(PrintRequest request)
    {
        var grayscale = string.Equals(request.ColorMode, "BW", StringComparison.OrdinalIgnoreCase);
        if (request.MimeType.Contains("pdf", StringComparison.OrdinalIgnoreCase) ||
            request.FilePath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            var stream = new FileStream(request.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            try
            {
                return new PdfPageSource(stream, request.PageFrom, request.PageTo, grayscale);
            }
            catch
            {
                stream.Dispose();
                throw;
            }
        }

        return new ImagePageSource(request.FilePath, grayscale);
    }
}
