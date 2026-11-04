using System.Drawing.Printing;
using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.Printing;

/// <summary>
/// Resolves canonical paper size names (A4, A3, A5, LETTER, LEGAL, …) to a
/// <see cref="PaperSize"/> exposed by the target printer's driver. If the printer
/// does not offer the requested size, the printer default is used (null returned)
/// and the mismatch is logged.
/// </summary>
public static class PaperSizeResolver
{
    /// <summary>
    /// Finds the best matching <see cref="PaperSize"/> on the target printer.
    /// Returns null when nothing matches (the printer default is used then).
    /// </summary>
    public static PaperSize? Resolve(PrinterSettings printer, string? requested)
    {
        if (string.IsNullOrWhiteSpace(requested)) return null;

        var kind = MapToKind(requested);
        foreach (PaperSize size in printer.PaperSizes)
        {
            if (kind.HasValue && size.Kind == kind.Value) return size;
            if (size.PaperName?.Equals(requested, StringComparison.OrdinalIgnoreCase) == true) return size;
        }

        Logger.Warn(
            $"Paper size '{requested}' is not available on '{printer.PrinterName}' — using the printer default.");
        return null;
    }

    private static PaperKind? MapToKind(string requested) => requested.Trim().ToUpperInvariant() switch
    {
        "A2" => PaperKind.A2,
        "A3" => PaperKind.A3,
        "A4" => PaperKind.A4,
        "A5" => PaperKind.A5,
        "A6" => PaperKind.A6,
        "LETTER" or "US LETTER" => PaperKind.Letter,
        "LEGAL" or "US LEGAL" => PaperKind.Legal,
        "TABLOID" or "11X17" => PaperKind.Tabloid,
        _ => null,
    };
}
