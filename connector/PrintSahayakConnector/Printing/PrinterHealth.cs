using PrintSahayakConnector.Core;
using System.Management;

namespace PrintSahayakConnector.Printing;

/// <summary>Hardware health of one Windows printer, read from WMI.</summary>
/// <param name="Status">Canonical code sent to the server:
/// OK | LOW_TONER | NO_TONER | LOW_PAPER | NO_PAPER | PAPER_JAM | OFFLINE | ERROR</param>
/// <param name="Detail">Short Hindi + English explanation shown in the dashboard.</param>
public sealed record PrinterHealth(string Status, string? Detail);

/// <summary>
/// Reads printer hardware health (toner / ink, paper, jam, offline) through the
/// Windows WMI <c>Win32_Printer</c> provider. Every failure is fail-soft: if WMI
/// is unavailable or a printer does not expose the fields, the printer is simply
/// reported as OK rather than guessing.
/// </summary>
public static class PrinterHealthReader
{
    /// <summary>Reads the health of one printer by its exact Windows name.</summary>
    public static PrinterHealth Read(string printerName)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Name, DetectedErrorState, PrinterStatus, WorkOffline FROM Win32_Printer " +
                $"WHERE Name = '{printerName.Replace("\\", "\\\\").Replace("'", "\\'")}'");
            foreach (var printer in searcher.Get())
            {
                try
                {
                    var workOffline = printer["WorkOffline"] is bool off && off;
                    var errorState = printer["DetectedErrorState"] as uint? ?? 0u;
                    var printerStatus = printer["PrinterStatus"] as uint? ?? 0u;
                    return Map(workOffline, errorState, printerStatus);
                }
                finally
                {
                    printer.Dispose();
                }
            }

            return new PrinterHealth("OK", null); // printer not visible to WMI — assume fine
        }
        catch (Exception ex)
        {
            Logger.Debug($"Health query failed for '{printerName}': {ex.Message}");
            return new PrinterHealth("OK", null);
        }
    }

    private static PrinterHealth Map(bool workOffline, uint errorState, uint printerStatus)
    {
        if (workOffline) return new PrinterHealth("OFFLINE", "Windows में printer offline है (Use Printer Offline on)");

        return errorState switch
        {
            3 => new PrinterHealth("LOW_TONER", "टोनर/इंक कम है — जल्दी बदलवाओ (toner/ink low)"),
            4 => new PrinterHealth("NO_TONER", "टोनर/इंक खत्म — बदलने तक printing रुक सकती है (toner/ink out)"),
            5 => new PrinterHealth("LOW_TONER", "लेज़र टोनर कम है (laser toner low)"),
            6 => new PrinterHealth("LOW_PAPER", "पेपर कम है (paper low)"),
            7 => new PrinterHealth("NO_PAPER", "पेपर खत्म — ट्रे में कागज़ डालो (out of paper)"),
            8 => new PrinterHealth("ERROR", "printer service मांग रहा है (service requested)"),
            9 => new PrinterHealth("ERROR", "आउटपुट ट्रे भर गई है (output bin full)"),
            10 => new PrinterHealth("PAPER_JAM", "पेपर जाम — printer खोलकर कागज़ निकालो (paper jam)"),
            11 => new PrinterHealth("ERROR", "printer error दिखा रहा है"),
            12 => new PrinterHealth("OFFLINE", "printer offline है"),
            13 => new PrinterHealth("ERROR", "printer service मांग रहा है (service requested)"),
            _ => printerStatus == 7
                ? new PrinterHealth("OFFLINE", "printer offline/उठाया नहीं जा सका (status offline)")
                : new PrinterHealth("OK", null),
        };
    }

    /// <summary>Worst-wins merge so a heartbeat list can carry the most severe state.</summary>
    public static string MergeWorst(string a, string b)
    {
        if (a == b) return a;
        var rank = new Dictionary<string, int>
        {
            { "OK", 0 }, { "LOW_PAPER", 1 }, { "LOW_TONER", 2 }, { "OFFLINE", 3 },
            { "NO_PAPER", 4 }, { "NO_TONER", 5 }, { "PAPER_JAM", 6 }, { "ERROR", 7 },
        };
        rank.TryGetValue(a, out var ra);
        rank.TryGetValue(b, out var rb);
        return rb > ra ? b : a;
    }
}
