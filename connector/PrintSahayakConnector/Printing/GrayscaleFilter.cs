using System.Drawing.Imaging;

namespace PrintSahayakConnector.Printing;

/// <summary>
/// Converts page bitmaps to grayscale via a GDI+ <see cref="ColorMatrix"/>
/// (luma weights 0.299/0.587/0.114). Used when a job requests B/W printing so
/// colour PDFs/images do not burn through colour toner.
/// </summary>
public static class GrayscaleFilter
{
    private static readonly ColorMatrix LumaMatrix = new()
    {
        Matrix00 = 0.299f, Matrix01 = 0.299f, Matrix02 = 0.299f,
        Matrix10 = 0.587f, Matrix11 = 0.587f, Matrix12 = 0.587f,
        Matrix20 = 0.114f, Matrix21 = 0.114f, Matrix22 = 0.114f,
    };

    /// <summary>Returns a new grayscale copy of the source bitmap (caller disposes).</summary>
    public static Bitmap Apply(Bitmap source)
    {
        var result = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(result);
        using var attributes = new ImageAttributes();
        attributes.SetColorMatrix(LumaMatrix);
        graphics.DrawImage(
            source,
            new Rectangle(0, 0, result.Width, result.Height),
            0, 0, source.Width, source.Height,
            GraphicsUnit.Pixel,
            attributes);
        return result;
    }
}
