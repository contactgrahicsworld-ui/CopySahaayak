using PrintSahayakConnector.Api;
using PrintSahayakConnector.Core;
using System.Drawing.Printing;

namespace PrintSahayakConnector.Printing;

/// <summary>A resolved print target and why it was chosen.</summary>
/// <param name="Name">Exact Windows printer name to hand to <see cref="PrinterSettings"/>.</param>
/// <param name="Source">Human readable explanation for the logs.</param>
public sealed record ResolvedPrinter(string Name, string Source);

/// <summary>
/// Chooses the printer a job is printed on — printer-pool aware:
/// 1. the printer the server assigned, when installed AND its spooler queue is idle,
/// 2. otherwise a locally mapped printer matching the job's colour mode whose
///    spooler queue is empty (a second black-and-white printer picks up the job
///    immediately when the first one is busy — same for colour printers),
/// 3. otherwise the least-busy matching mapping, then ANY-mode mappings,
/// 4. the Windows default printer as a last resort.
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

        var jobMode = job.PrintSettings?.ColorMode;
        var candidates = store.GetPrinters()
            .Where(mapping => installed.Contains(mapping.WindowsName) && ModesMatch(mapping.ColorMode, jobMode))
            .ToList();

        // Spooler queue lengths are queried lazily and only once per resolution.
        var queue = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int QueueLength(string name)
        {
            if (queue.TryGetValue(name, out var known)) return known;
            try
            {
                known = SpoolerMonitor.GetJobs(name).Count;
            }
            catch (Exception ex)
            {
                Logger.Debug($"Queue probe failed for '{name}': {ex.Message}");
                known = -1; // unknown — neither prefer nor punish
            }

            queue[name] = known;
            return known;
        }

        var requested = job.Printer?.WindowsName;
        if (!string.IsNullOrWhiteSpace(requested) && installed.Contains(requested))
        {
            if (QueueLength(requested) == 0)
            {
                return new ResolvedPrinter(requested, "assigned by the shop (idle)");
            }

            var idleAlt = candidates
                .Where(mapping => !mapping.WindowsName.Equals(requested, StringComparison.OrdinalIgnoreCase))
                .OrderBy(mapping => OrderKey(mapping.ColorMode, jobMode))
                .ThenBy(mapping => Math.Max(0, QueueLength(mapping.WindowsName)))
                .FirstOrDefault(mapping => QueueLength(mapping.WindowsName) == 0);
            if (idleAlt != null)
            {
                Logger.Info($"Assigned printer '{requested}' is busy — switching to idle '{idleAlt.WindowsName}'.");
                return new ResolvedPrinter(idleAlt.WindowsName, $"pool switch (assigned busy, {idleAlt.ColorMode} idle)");
            }

            // No idle alternative — keep the assignment (fall through).
        }
        else if (!string.IsNullOrWhiteSpace(requested))
        {
            Logger.Warn($"Assigned printer '{requested}' is not installed on this machine — falling back to the local mapping.");
        }

        var idleExact = candidates
            .OrderBy(mapping => OrderKey(mapping.ColorMode, jobMode))
            .ThenBy(mapping => mapping.WindowsName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(mapping => QueueLength(mapping.WindowsName) == 0);
        if (idleExact != null)
        {
            return new ResolvedPrinter(idleExact.WindowsName, $"local mapping idle ({jobMode ?? "ANY"})");
        }

        // Everything matching is busy or unprobeable — least busy first (unknown = large).
        var leastBusy = candidates
            .OrderBy(mapping => OrderKey(mapping.ColorMode, jobMode))
            .ThenBy(mapping => QueueLength(mapping.WindowsName) < 0 ? int.MaxValue : QueueLength(mapping.WindowsName))
            .ThenBy(mapping => mapping.WindowsName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (leastBusy != null)
        {
            var busy = QueueLength(leastBusy.WindowsName);
            return new ResolvedPrinter(leastBusy.WindowsName, busy < 0
                ? "local mapping (queue unknown)"
                : $"local mapping (all busy — least busy, {busy} queued)");
        }

        var defaultName = new PrinterSettings().PrinterName;
        Logger.Warn($"No matching mapping found — falling back to the Windows default printer '{defaultName}'.");
        return new ResolvedPrinter(defaultName, "Windows default printer");
    }

    /// <summary>Exact-mode matches first, ANY-mode second (when the job declares a mode).</summary>
    private static int OrderKey(string mappedMode, string? jobMode)
    {
        if (string.IsNullOrEmpty(jobMode)) return mappedMode.Equals("ANY", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        if (mappedMode.Equals(jobMode, StringComparison.OrdinalIgnoreCase)) return 0;
        return mappedMode.Equals("ANY", StringComparison.OrdinalIgnoreCase) ? 1 : 2;
    }

    private static bool ModesMatch(string mappedMode, string? jobMode) =>
        string.IsNullOrEmpty(jobMode) ||
        mappedMode.Equals("ANY", StringComparison.OrdinalIgnoreCase) ||
        mappedMode.Equals(jobMode, StringComparison.OrdinalIgnoreCase);
}
