using PhotocopyShopConnector.Api;
using PhotocopyShopConnector.Core;
using System.Drawing.Printing;

namespace PhotocopyShopConnector.Printing;

/// <summary>A resolved print target and why it was chosen.</summary>
/// <param name="Name">Exact Windows printer name to hand to <see cref="PrinterSettings"/>.</param>
/// <param name="Source">Human readable explanation for the logs.</param>
public sealed record ResolvedPrinter(string Name, string Source);

/// <summary>
/// Chooses the printer a job is printed on:
/// 1. the printer the server assigned (when installed locally),
/// 2. a locally mapped printer matching the job's colour mode (BW/COLOR, then ANY),
/// 3. the Windows default printer as a last resort.
/// </summary>
public static class PrinterResolver
{
    /// <summary>Resolves the target printer for a claimed job.</summary>
    public static ResolvedPrinter Resolve(ClaimedJob job, LocalStore store)
    {
        var installed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string name in PrinterSettings.InstalledPrinters)
        {
            installed.Add(name);
        }

        var requested = job.Printer?.WindowsName;
        if (!string.IsNullOrWhiteSpace(requested))
        {
            if (installed.Contains(requested))
            {
                return new ResolvedPrinter(requested, "assigned by the shop");
            }

            Logger.Warn($"Assigned printer '{requested}' is not installed on this machine — falling back to the local mapping.");
        }

        var jobMode = job.PrintSettings?.ColorMode;
        var mappings = store.GetPrinters();

        var exact = mappings.FirstOrDefault(mapping =>
            installed.Contains(mapping.WindowsName) && ModesMatch(mapping.ColorMode, jobMode));
        if (exact != null)
        {
            return new ResolvedPrinter(exact.WindowsName, $"local mapping ({jobMode ?? "ANY"})");
        }

        var any = mappings.FirstOrDefault(mapping =>
            installed.Contains(mapping.WindowsName) &&
            mapping.ColorMode.Equals("ANY", StringComparison.OrdinalIgnoreCase));
        if (any != null)
        {
            return new ResolvedPrinter(any.WindowsName, "local ANY mapping");
        }

        var defaultName = new PrinterSettings().PrinterName;
        Logger.Warn($"No matching mapping found — falling back to the Windows default printer '{defaultName}'.");
        return new ResolvedPrinter(defaultName, "Windows default printer");
    }

    private static bool ModesMatch(string mappedMode, string? jobMode) =>
        string.IsNullOrEmpty(jobMode) ||
        mappedMode.Equals("ANY", StringComparison.OrdinalIgnoreCase) ||
        mappedMode.Equals(jobMode, StringComparison.OrdinalIgnoreCase);
}
