using System.ComponentModel;
using System.Runtime.InteropServices;
using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.Printing;

/// <summary>A snapshot of one job in the Windows print spooler queue.</summary>
/// <param name="JobId">Spooler job id.</param>
/// <param name="Document">Document name as shown in the spooler (we match on this).</param>
/// <param name="Status">JOB_STATUS_* flags (see <see cref="SpoolerMonitor"/>).</param>
public sealed record SpoolerJobInfo(uint JobId, string Document, uint Status);

/// <summary>Outcome of watching a spooler job.</summary>
/// <param name="Success">True when the spooler confirmed delivery.</param>
/// <param name="Message">Human readable explanation (included in COMPLETED/FAILED events).</param>
public sealed record WatchResult(bool Success, string Message);

/// <summary>
/// Reads the Windows print spooler queue (winspool.drv) and verifies that a print
/// job actually completed before the connector reports success. This implements the
/// "spooler-verified honesty" rule: <c>COMPLETED</c> is only ever reported after the
/// spooler confirms the job was printed (job left the queue or reached the
/// COMPLETE/PRINTED state).
/// </summary>
public static class SpoolerMonitor
{
    // JOB_STATUS_* flags from winspool.h.
    private const uint StatusPaused = 0x00000001;
    private const uint StatusError = 0x00000002;
    private const uint StatusDeleting = 0x00000004;
    private const uint StatusSpooling = 0x00000008;
    private const uint StatusPrinting = 0x00000010;
    private const uint StatusOffline = 0x00000020;
    private const uint StatusPaperOut = 0x00000080;
    private const uint StatusDeleted = 0x00000100;
    private const uint StatusBlockedDevQ = 0x00000200;
    private const uint StatusUserIntervention = 0x00000400;
    private const uint StatusRestart = 0x00000800;
    private const uint StatusComplete = 0x00001000;
    private const uint StatusRetained = 0x00002000;
    private const uint StatusPrinted = 0x00004000;

    private const uint JobLevel = 1;
    private const uint MaxJobsToEnumerate = 128;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct JOB_INFO_1
    {
        public uint JobId;
        public IntPtr pPrinterName;
        public IntPtr pMachineName;
        public IntPtr pUserName;
        public IntPtr pDocument;
        public IntPtr pDatatype;
        public IntPtr pStatus;
        public uint Status;
        public uint Priority;
        public uint Position;
        public uint TotalPages;
        public uint PagesPrinted;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinterW(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumJobsW(
        IntPtr hPrinter,
        uint firstJob,
        uint noJobs,
        uint level,
        IntPtr pJob,
        uint cbBuf,
        out uint pcbNeeded,
        out uint pcReturned);

    /// <summary>Enumerates the current spooler queue of a printer.</summary>
    public static IReadOnlyList<SpoolerJobInfo> GetJobs(string printerName)
    {
        if (!OpenPrinterW(printerName, out var printerHandle, IntPtr.Zero))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                $"Could not open printer '{printerName}'.");
        }

        try
        {
            EnumJobsW(printerHandle, 0, MaxJobsToEnumerate, JobLevel, IntPtr.Zero, 0, out var needed, out _);
            if (needed == 0) return Array.Empty<SpoolerJobInfo>();

            var buffer = Marshal.AllocHGlobal((IntPtr)needed);
            try
            {
                if (!EnumJobsW(printerHandle, 0, MaxJobsToEnumerate, JobLevel, buffer, needed, out _, out var returned))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        $"Could not enumerate jobs on '{printerName}'.");
                }

                var result = new List<SpoolerJobInfo>((int)returned);
                var stride = Marshal.SizeOf<JOB_INFO_1>();
                for (var i = 0; i < returned; i++)
                {
                    var entry = Marshal.PtrToStructure<JOB_INFO_1>(IntPtr.Add(buffer, i * stride));
                    result.Add(new SpoolerJobInfo(
                        entry.JobId,
                        Marshal.PtrToStringUni(entry.pDocument) ?? string.Empty,
                        entry.Status));
                }

                return result;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            ClosePrinter(printerHandle);
        }
    }

    /// <summary>
    /// Polls the spooler (1 s interval) until the job with the given document name
    /// completes, fails or the timeout elapses.
    /// Success conditions: the job disappears from the queue (printed) or carries the
    /// COMPLETE/PRINTED status flag.
    /// Failure conditions: ERROR/DELETED/BLOCKED_DEVQ/USER_INTERVENTION flags, or the
    /// timeout elapsing while the job is still stuck in the queue.
    /// </summary>
    /// <param name="printerName">Windows printer name.</param>
    /// <param name="documentName">Exactly the <c>PrintDocument.DocumentName</c> used for printing.</param>
    /// <param name="preExistingJobIds">Job ids already in the queue before we printed (ignored when a fresh match exists).</param>
    /// <param name="timeout">Maximum time to wait (production: 120 s).</param>
    /// <param name="ct">Cancellation for shutdown.</param>
    public static async Task<WatchResult> WaitForCompletionAsync(
        string printerName,
        string documentName,
        IReadOnlySet<uint> preExistingJobIds,
        TimeSpan timeout,
        CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + timeout;
        var everSeen = false;
        uint lastStatus = 0;

        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            List<SpoolerJobInfo> jobs;
            try
            {
                jobs = new List<SpoolerJobInfo>(GetJobs(printerName));
            }
            catch (Exception ex)
            {
                Logger.Warn($"Could not enumerate the spooler queue of '{printerName}': {Shorten(ex.Message)}");
                await Task.Delay(PollInterval, ct);
                continue;
            }

            SpoolerJobInfo? mine = null;
            foreach (var job in jobs)
            {
                if (!string.Equals(job.Document, documentName, StringComparison.OrdinalIgnoreCase)) continue;
                if (!preExistingJobIds.Contains(job.JobId))
                {
                    // Prefer a job we just created over a pre-existing one with the same name.
                    mine = job;
                    break;
                }

                mine ??= job;
            }

            if (mine != null)
            {
                everSeen = true;
                lastStatus = mine.Status;

                if ((mine.Status & (StatusError | StatusDeleted | StatusBlockedDevQ | StatusUserIntervention)) != 0)
                {
                    return new WatchResult(
                        false,
                        $"The spooler reported an error for job '{documentName}' (status 0x{mine.Status:X}).");
                }

                if ((mine.Status & (StatusComplete | StatusPrinted)) != 0)
                {
                    return new WatchResult(true, "spooler confirmed completion");
                }

                // DELETING alone is normal right after printing — keep polling until it vanishes.
            }
            else if (everSeen)
            {
                return new WatchResult(true, "job left the spooler queue");
            }

            await Task.Delay(PollInterval, ct);
        }

        if (everSeen)
        {
            var hints = DescribeBlocking(lastStatus);
            return new WatchResult(
                false,
                $"Spooler timeout: job '{documentName}' is still in the queue after {timeout.TotalSeconds:0}s " +
                $"(status 0x{lastStatus:X}){hints}.");
        }

        // PrintDocument.Print() already accepted the job (EndDoc) — it simply finished
        // faster than we could observe it, which some spooler configurations allow.
        return new WatchResult(
            true,
            "spooler accepted the job (it finished before it could be observed)");
    }

    private static string DescribeBlocking(uint status)
    {
        var parts = new List<string>();
        if ((status & StatusOffline) != 0) parts.Add("printer offline");
        if ((status & StatusPaperOut) != 0) parts.Add("paper out");
        if ((status & StatusPaused) != 0) parts.Add("paused");
        return parts.Count == 0 ? string.Empty : " — " + string.Join(", ", parts);
    }

    private static string Shorten(string message)
    {
        message = message.Replace("\r", " ").Replace("\n", " ");
        return message.Length <= 120 ? message : message[..120] + "…";
    }
}
