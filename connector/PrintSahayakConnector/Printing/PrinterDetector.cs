using PrintSahayakConnector.Core;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

namespace PrintSahayakConnector.Printing;

/// <summary>
/// Discovers the physical printers installed on this PC and builds ready-to-use
/// mappings for them — the "install and everything just works" requirement:
///   • every physical (non-virtual) printer is enabled automatically,
///   • colour-capable printers are tagged COLOR, the rest BW,
///   • the printer's own default paper size (A4/A3/A5/LEGAL/LETTER) is carried over,
///   • printers the owner deliberately disabled stay disabled (LocalStore removed list).
/// The owner can always fine-tune everything in Printer Settings….
/// </summary>
public static class PrinterDetector
{
    private const int DcColor = 12; // DeviceCapabilities: 1 = printer supports colour

    // Virtual "printers" that can never receive real paper — auto-detection skips them.
    private static readonly string[] VirtualMarkers =
    {
        "microsoft print to pdf", "microsoft xps document writer", "xps writer",
        "onenote", "fax", "adobe pdf", "pdf architect", "nitro pdf",
        "send to onenote", "exportwriter", "image writer",
    };

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int DeviceCapabilitiesW(
        string device, string port, short capability, IntPtr outputBuffer, IntPtr deviceMode);

    /// <summary>All installed printer names (sorted).</summary>
    public static IReadOnlyList<string> InstalledPrinterNames()
    {
        var names = new List<string>();
        foreach (string name in PrinterSettings.InstalledPrinters)
        {
            names.Add(name);
        }

        return names.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>True for PDF/XPS/Fax/OneNote style virtual printers.</summary>
    public static bool IsVirtual(string printerName)
    {
        var lower = printerName.ToLowerInvariant();
        return VirtualMarkers.Any(lower.Contains);
    }

    /// <summary>True when the printer hardware can print in colour (DeviceCapabilities DC_COLOR).</summary>
    public static bool SupportsColor(string printerName)
    {
        try
        {
            // The friendly Windows name works for winspool queries; the port is not needed.
            return DeviceCapabilitiesW(printerName, string.Empty, DcColor, IntPtr.Zero, IntPtr.Zero) == 1;
        }
        catch (Exception ex)
        {
            Logger.Debug($"Colour probe failed for '{printerName}': {ex.Message}");
            return false;
        }
    }

    /// <summary>Canonical default paper size (A4/A3/A5/LEGAL/LETTER) or empty.</summary>
    public static string DefaultPaperSize(string printerName)
    {
        try
        {
            var settings = new PrinterSettings { PrinterName = printerName };
            var kind = settings.DefaultPageSettings.PaperSize?.RawKind;
            return kind switch
            {
                9 => "A4",    // PaperKind.A4
                8 => "A3",    // PaperKind.A3
                11 => "A5",   // PaperKind.A5
                5 => "LEGAL", // PaperKind.Legal
                1 => "LETTER",// PaperKind.Letter
                _ => string.Empty,
            };
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// Builds the auto-detected mappings: every physical printer that is neither
    /// saved yet nor explicitly removed by the owner becomes a mapping — colour
    /// capable printers COLOR, everything else BW.
    /// </summary>
    public static IReadOnlyList<Core.PrinterMapping> BuildAutoMappings(
        IReadOnlyList<Core.PrinterMapping> saved,
        IReadOnlyCollection<string> removed)
    {
        var known = new HashSet<string>(saved.Select(m => m.WindowsName), StringComparer.OrdinalIgnoreCase);
        var blocked = new HashSet<string>(removed, StringComparer.OrdinalIgnoreCase);
        var result = new List<Core.PrinterMapping>(saved);

        foreach (var name in InstalledPrinterNames())
        {
            if (known.Contains(name) || blocked.Contains(name) || IsVirtual(name)) continue;

            var colorMode = SupportsColor(name) ? "COLOR" : "BW";
            result.Add(new Core.PrinterMapping(name, colorMode, DefaultPaperSize(name)));
            Logger.Info($"Auto-detected printer '{name}' → {colorMode}.");
        }

        return result;
    }
}
