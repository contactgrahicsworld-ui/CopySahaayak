using PrintSahayakConnector.Api;

namespace PrintSahayakConnector.Core;

/// <summary>
/// Periodically asks the shop server for the newest connector version and raises
/// <see cref="UpdateAvailable"/> once per new version. All network failures are
/// swallowed and logged — an update check must never disturb printing or pairing.
/// </summary>
public sealed class UpdateChecker : IDisposable
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

    private readonly ApiClient _api;
    private readonly PeriodicTimer _timer = new(CheckInterval);
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;
    private string? _lastNotifiedVersion;
    private bool _disposed;

    /// <summary>Raised on a background thread with (version, downloadUrl) when the server has a newer build.</summary>
    public event Action<string, string>? UpdateAvailable;

    /// <summary>Creates the checker against the given (paired) API client.</summary>
    public UpdateChecker(ApiClient api)
    {
        _api = api;
    }

    /// <summary>Starts the background loop (first check after <see cref="StartupDelay"/>).</summary>
    public void Start()
    {
        _loop = Task.Run(() => RunAsync(_cts.Token));
    }

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            // Small startup delay so pairing and the worker's first heartbeats get priority.
            await Task.Delay(StartupDelay, ct);
            while (true)
            {
                await CheckOnceAsync(ct);
                if (!await _timer.WaitForNextTickAsync(ct)) break;
            }
        }
        catch (OperationCanceledException)
        {
            // normal shutdown
        }
        catch (Exception ex)
        {
            Logger.Warn($"Update checker stopped unexpectedly: {ex.Message}");
        }
    }

    /// <summary>Queries the server once and notifies (once per version) when it is newer.</summary>
    public async Task CheckOnceAsync(CancellationToken ct)
    {
        var info = await _api.GetLatestVersionAsync(ct);
        var version = info?.Version;
        var url = info?.DownloadUrl;
        if (string.IsNullOrWhiteSpace(version) || string.IsNullOrWhiteSpace(url)) return;
        if (!VersionComparer.IsNewer(version, Program.AppVersion)) return;
        if (version.Equals(_lastNotifiedVersion, StringComparison.OrdinalIgnoreCase)) return;

        _lastNotifiedVersion = version;
        Logger.Info($"Update available on the server: {version} (running {Program.AppVersion}).");
        UpdateAvailable?.Invoke(version, url);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        try
        {
            _loop?.Wait(TimeSpan.FromSeconds(2));
        }
        catch
        {
            // the loop ends on its own; never block shutdown on it
        }

        _cts.Dispose();
        _timer.Dispose();
    }
}
