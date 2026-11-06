using System.Net;
using PrintSahayakConnector.Api;
using PrintSahayakConnector.Printing;

namespace PrintSahayakConnector.Core;

/// <summary>High level worker state surfaced in the tray and the status window.</summary>
public enum WorkerState
{
    NotPaired,
    Waiting,
    Downloading,
    Printing,
    Reporting,
    Backoff,
    Revoked,
    Stopped,
}

/// <summary>Severity for tray balloon notifications.</summary>
public enum BalloonKind
{
    Info,
    Error,
}

/// <summary>Immutable snapshot of the worker status for the UI.</summary>
public sealed record WorkerStatus(
    WorkerState State,
    string Detail,
    DateTime? LastHeartbeatUtc,
    DateTime? LastCheckUtc,
    int BackoffSeconds);

/// <summary>Thrown when the server reports this device as revoked.</summary>
public sealed class DeviceRevokedException : Exception
{
    /// <inheritdoc />
    public DeviceRevokedException() : base("This device has been revoked by the shop admin.")
    {
    }
}

/// <summary>
/// Background loop: heartbeats the device and its printer mapping (~every 20 s),
/// claims print jobs (~every 15 s), downloads documents, prints them with spooler
/// verification and reports events. Every exception is caught, logged and retried
/// with exponential backoff (15 s → 30 s → 60 s … capped at 5 min) — a crashed
/// worker loop would be a silent shop outage.
/// </summary>
public sealed class JobWorker : IDisposable
{
    private static readonly TimeSpan ClaimInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan InitialBackoff = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(5);

    private readonly LocalStore _store;
    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly object _lifecycleGate = new();
    private readonly object _statusGate = new();

    private CancellationTokenSource _cts = new();
    private ApiClient? _api;
    private Task? _loop;
    private volatile bool _disposed;
    private volatile bool _heartbeatRequested;

    private WorkerState _state = WorkerState.NotPaired;
    private string _detail = "Starting…";
    private int _backoffSeconds;
    private DateTime? _lastHeartbeatUtc;
    private DateTime? _lastCheckUtc;

    /// <summary>Raised (on a worker thread) whenever the status snapshot changes.</summary>
    public event Action<WorkerStatus>? StatusChanged;

    /// <summary>Raised (on a worker thread) when the user should be notified via a tray balloon.</summary>
    public event Action<string, BalloonKind>? NotifyUser;

    /// <summary>Creates a worker for the given store/API pair.</summary>
    public JobWorker(LocalStore store, ApiClient api)
    {
        _store = store;
        _api = api;
    }

    /// <summary>Current immutable status snapshot.</summary>
    public WorkerStatus Status
    {
        get
        {
            lock (_statusGate)
            {
                return new WorkerStatus(_state, _detail, _lastHeartbeatUtc, _lastCheckUtc, _backoffSeconds);
            }
        }
    }

    /// <summary>Starts the background loop (no-op when already running).</summary>
    public void Start()
    {
        lock (_lifecycleGate)
        {
            if (_loop != null || _disposed) return;
            _heartbeatRequested = true; // force an initial heartbeat
            _loop = Task.Run(() => RunAsync(_cts.Token));
        }
    }

    /// <summary>
    /// Swaps in a fresh API client (after re-pairing) and restarts the loop.
    /// The previous loop exits after finishing any job it is currently printing.
    /// </summary>
    public void RestartWith(ApiClient api)
    {
        Task? oldLoop;
        CancellationTokenSource oldCts;
        lock (_lifecycleGate)
        {
            oldLoop = _loop;
            oldCts = _cts;
            _loop = null;
            _cts = new CancellationTokenSource();
        }

        oldCts.Cancel();
        if (oldLoop != null && !oldLoop.Wait(TimeSpan.FromSeconds(3)))
        {
            Logger.Warn("Previous worker loop is still finishing a job; it will exit once done.");
        }

        oldCts.Dispose();
        _api?.Dispose();
        _api = api;
        lock (_statusGate) { _lastHeartbeatUtc = null; }
        _heartbeatRequested = true;
        Start();
    }

    /// <summary>Forces the next loop iteration immediately and requests a fresh heartbeat.</summary>
    public void CheckNow()
    {
        _heartbeatRequested = true;
        try { _wake.Release(); }
        catch (SemaphoreFullException)
        {
            // A wake signal is already pending — the next iteration will pick it up.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        CancellationTokenSource cts;
        Task? loop;
        lock (_lifecycleGate)
        {
            _disposed = true;
            cts = _cts;
            loop = _loop;
            _loop = null;
        }

        cts.Cancel();
        try
        {
            loop?.Wait(TimeSpan.FromSeconds(3));
        }
        catch (AggregateException)
        {
            // Abandoned in-flight job — already logged by the loop itself.
        }

        _api?.Dispose();
        cts.Dispose();
        _wake.Dispose();
    }

    private async Task RunAsync(CancellationToken ct)
    {
        Logger.Info("Worker loop started.");
        var backoffSeconds = 0d;

        while (!ct.IsCancellationRequested)
        {
            var api = _api!;
            try
            {
                await SendHeartbeatAsync(api, ct);

                SetStatus(WorkerState.Waiting, "Checking for print jobs…");
                var claim = await api.ClaimJobAsync(ct);
                lock (_statusGate) { _lastCheckUtc = DateTime.UtcNow; }
                backoffSeconds = 0;

                if (claim.Job is null)
                {
                    SetStatus(WorkerState.Waiting, "Waiting for print jobs");
                    await WaitForNextIterationAsync(ClaimInterval, ct);
                }
                else
                {
                    await ProcessJobAsync(api, claim.Job, ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested || _disposed)
            {
                break;
            }
            catch (DeviceRevokedException)
            {
                await ParkRevokedAsync(ct);
                break;
            }
            catch (ApiException ex) when (ex.StatusCode == HttpStatusCode.Unauthorized && !_disposed)
            {
                // The device token no longer exists on the server — the device was
                // revoked or removed in the dashboard, so every call answers 401
                // "Device not authenticated". Retrying forever would only spam the
                // logs (401 every 15 s … 5 min); park the loop and ask for a re-pair.
                Logger.Warn($"Device token was rejected ({Shorten(ex.Message)}) — treating the device as revoked.");
                await ParkRevokedAsync(ct);
                break;
            }
            catch (Exception ex)
            {
                if (_disposed || ct.IsCancellationRequested) break;
                backoffSeconds = backoffSeconds == 0
                    ? InitialBackoff.TotalSeconds
                    : Math.Min(backoffSeconds * 2, MaxBackoff.TotalSeconds);
                var wait = TimeSpan.FromSeconds(backoffSeconds);
                Logger.Error($"Worker loop error — retrying in {wait.TotalSeconds:0}s.", ex);
                SetStatus(WorkerState.Backoff,
                    $"Connection problem: {Shorten(ex.Message)} — retrying in {wait.TotalSeconds:0}s",
                    (int)backoffSeconds);
                try
                {
                    await WaitForNextIterationAsync(wait, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        SetStatus(WorkerState.Stopped, "Stopped");
        Logger.Info("Worker loop stopped.");
    }

    /// <summary>
    /// Parks the worker loop after the device was revoked or removed: stops all
    /// server calls, surfaces a clear status and asks for a re-pair. Pairing again
    /// restarts the loop with a fresh token via <see cref="RestartWith"/>.
    /// </summary>
    private async Task ParkRevokedAsync(CancellationToken ct)
    {
        SetStatus(WorkerState.Revoked, "Revoked or removed by the shop admin — pair again to reconnect.");
        NotifyUser?.Invoke(
            "This device was revoked or removed by the shop admin. Use “Pair with Shop…” to reconnect.",
            BalloonKind.Error);
        Logger.Warn("Device revoked or removed — parking the worker loop until re-pairing.");
        try
        {
            await Task.Delay(Timeout.Infinite, ct);
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown or re-pair — this loop exits and a fresh one starts.
        }
    }

    private async Task SendHeartbeatAsync(ApiClient api, CancellationToken ct)
    {
        if (!_heartbeatRequested &&
            _lastHeartbeatUtc.HasValue &&
            DateTime.UtcNow - _lastHeartbeatUtc.Value < HeartbeatInterval)
        {
            return;
        }

        var printers = _store.GetPrinters()
            .Select(mapping => new HeartbeatPrinter(
                mapping.WindowsName,
                mapping.ColorMode,
                string.IsNullOrWhiteSpace(mapping.DefaultPaperSize)
                    ? new List<string>()
                    : new List<string> { mapping.DefaultPaperSize }))
            .ToList();

        var response = await api.HeartbeatAsync(new HeartbeatRequest(printers, Program.AppVersion), ct);
        lock (_statusGate) { _lastHeartbeatUtc = DateTime.UtcNow; }
        _heartbeatRequested = false;
        Logger.Debug($"Heartbeat sent ({printers.Count} printer(s)), deviceStatus={response.DeviceStatus}.");

        if (string.Equals(response.DeviceStatus, "REVOKED", StringComparison.OrdinalIgnoreCase))
        {
            throw new DeviceRevokedException();
        }
    }

    private async Task ProcessJobAsync(ApiClient api, ClaimedJob job, CancellationToken ct)
    {
        Logger.Info(
            $"Claimed job {job.Id} ({job.OrderNumber}): {job.Document.FileName} ({job.Document.MimeType}), " +
            $"{job.PrintSettings?.Copies ?? 1} copy(ies), {job.PrintSettings?.ColorMode ?? "?"}, " +
            $"{job.PrintSettings?.PaperSize ?? "?"}, duplex={job.PrintSettings?.Duplex ?? false} " +
            $"-> {job.Printer?.WindowsName ?? "(auto)"}");

        // Duplicate prevention: never print a job this device already completed.
        if (_store.IsJobCompleted(job.Id))
        {
            Logger.Info($"Job {job.Id} was already printed by this device (duplicate claim).");
            await PostEventWithRetryAsync(api, job.Id, "COMPLETED", "already printed (dedupe)", ct);
            return;
        }

        string? tempFile = null;
        try
        {
            SetStatus(WorkerState.Downloading, $"Downloading {job.Document.FileName}…");
            tempFile = await api.DownloadDocumentAsync(job, ct);

            var target = PrinterResolver.Resolve(job, _store);
            Logger.Info($"Printing job {job.Id} on '{target.Name}' ({target.Source}).");

            SetStatus(WorkerState.Printing, $"Printing {job.OrderNumber} on {target.Name}…");
            var executor = new PrintJobExecutor();
            var result = await Task.Run(() => executor.Execute(
                new PrintRequest(
                    FilePath: tempFile,
                    MimeType: job.Document.MimeType ?? string.Empty,
                    SpoolDocumentName: string.IsNullOrWhiteSpace(job.SpoolDocumentName)
                        ? $"PCS-{job.Id}"
                        : job.SpoolDocumentName,
                    PrinterName: target.Name,
                    Copies: Math.Max(1, job.PrintSettings?.Copies ?? 1),
                    ColorMode: job.PrintSettings?.ColorMode ?? "ANY",
                    PaperSize: string.IsNullOrWhiteSpace(job.PrintSettings?.PaperSize)
                        ? null
                        : job.PrintSettings!.PaperSize,
                    Duplex: job.PrintSettings?.Duplex ?? false,
                    PageFrom: job.PrintSettings?.PageFrom,
                    PageTo: job.PrintSettings?.PageTo),
                onSpooling: () => PostEventBestEffortAsync(api, job.Id, "SPOOLING", null, ct),
                ct), ct);

            if (result.Success)
            {
                // Record locally first: if the COMPLETED event cannot be delivered and
                // the server later re-queues the job, the dedupe check above reports
                // COMPLETED with a "already printed" note instead of printing twice.
                _store.MarkJobCompleted(job.Id, job.OrderNumber ?? string.Empty, result.Message);
                await PostEventWithRetryAsync(api, job.Id, "COMPLETED", result.Message, ct);
                Logger.Info($"Job {job.Id} COMPLETED: {result.Message}");
                NotifyUser?.Invoke($"Printed {job.OrderNumber} on {target.Name}.", BalloonKind.Info);
                SetStatus(WorkerState.Waiting, $"Completed {job.OrderNumber}");
            }
            else
            {
                Logger.Warn($"Job {job.Id} FAILED: {result.Message}");
                await PostEventWithRetryAsync(api, job.Id, "FAILED", result.Message, ct);
                NotifyUser?.Invoke($"Print failed for {job.OrderNumber}: {result.Message}", BalloonKind.Error);
                SetStatus(WorkerState.Waiting, "Last job failed — see logs");
            }
        }
        catch (Exception ex)
        {
            Logger.Error($"Job {job.Id} could not be processed.", ex);
            try
            {
                await PostEventWithRetryAsync(api, job.Id, "FAILED", ex.Message, ct);
            }
            catch (Exception reportEx)
            {
                Logger.Error($"Could not report FAILED for job {job.Id}.", reportEx);
            }

            NotifyUser?.Invoke($"Could not print {job.OrderNumber}: {Shorten(ex.Message)}", BalloonKind.Error);
            SetStatus(WorkerState.Waiting, $"Job {job.OrderNumber} failed: {Shorten(ex.Message)}");
        }
        finally
        {
            if (tempFile != null) TryDelete(tempFile);
        }
    }

    private async Task PostEventBestEffortAsync(
        ApiClient api, string jobId, string status, string? message, CancellationToken ct)
    {
        try
        {
            await api.PostJobEventAsync(jobId, status, message, ct);
            Logger.Info($"Posted {status} event for job {jobId}.");
        }
        catch (Exception ex)
        {
            Logger.Warn($"Could not post {status} event for job {jobId}: {Shorten(ex.Message)}");
        }
    }

    private async Task PostEventWithRetryAsync(
        ApiClient api, string jobId, string status, string? message, CancellationToken ct)
    {
        SetStatus(WorkerState.Reporting, $"Reporting {status}…");
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await api.PostJobEventAsync(jobId, status, message, ct);
                Logger.Info($"Posted {status} event for job {jobId} (attempt {attempt}).");
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested || _disposed)
            {
                throw;
            }
            catch (Exception ex)
            {
                if (attempt >= 3) throw;
                Logger.Warn(
                    $"Posting {status} for job {jobId} failed (attempt {attempt}): {Shorten(ex.Message)} — retrying.");
                await Task.Delay(TimeSpan.FromSeconds(2 * attempt), ct);
            }
        }
    }

    /// <summary>Wakes on a manual trigger or after the given timeout, whichever comes first.</summary>
    private async Task WaitForNextIterationAsync(TimeSpan timeout, CancellationToken ct)
    {
        await _wake.WaitAsync(timeout, ct);
    }

    private void SetStatus(WorkerState state, string detail, int backoffSeconds = 0)
    {
        WorkerStatus snapshot;
        lock (_statusGate)
        {
            _state = state;
            _detail = detail;
            _backoffSeconds = backoffSeconds;
            snapshot = new WorkerStatus(state, detail, _lastHeartbeatUtc, _lastCheckUtc, backoffSeconds);
        }

        StatusChanged?.Invoke(snapshot);
    }

    private static string Shorten(string message)
    {
        message = message.Replace("\r", " ").Replace("\n", " ");
        return message.Length <= 120 ? message : message[..120] + "…";
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Could not delete temp file {path}: {ex.Message}");
        }
    }
}
