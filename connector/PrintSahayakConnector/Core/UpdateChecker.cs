using PrintSahayakConnector.Api;

namespace PrintSahayakConnector.Core;

/// <summary>
/// Periodically asks the shop server for the newest connector version and raises
/// <see cref="UpdateAvailable"/> once per new version (or always, when forced by a
/// manual check). All network failures are swallowed and logged — an update check
/// must never disturb printing or pairing.
/// </summary>
public sealed class UpdateChecker : IDisposable
{
    /// <summary>Thirty minutes: a pushed fix should reach the shop within half an hour.</summary>
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

    private readonly ApiClient _api;
    private readonly PeriodicTimer _timer = new(CheckInterval);
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;
    private string? _lastNotifiedVersion;
    private bool _disposed;

    /// <summary>Raised on a background thread with the newest <see cref="UpdateInfo"/> when the server has a newer build.</summary>
    public event Action<UpdateInfo>? UpdateAvailable;

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
                await CheckOnceAsync(force: false, ct);
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

    /// <summary>
    /// Queries the server once. Returns true when a newer version was found and the
    /// <see cref="UpdateAvailable"/> event was raised. With <paramref name="force"/>
    /// (tray menu "Check for Updates") the once-per-version memory is ignored so a
    /// previously dismissed notice comes back.
    /// </summary>
    public async Task<bool> CheckOnceAsync(bool force = false, CancellationToken ct = default)
    {
        var info = await _api.GetLatestVersionAsync(ct);
        var version = info?.Version;
        if (string.IsNullOrWhiteSpace(version) || string.IsNullOrWhiteSpace(info!.DownloadUrl)) return false;
        if (!VersionComparer.IsNewer(version, Program.AppVersion)) return false;
        if (!force && version.Equals(_lastNotifiedVersion, StringComparison.OrdinalIgnoreCase)) return true; // already on screen once

        _lastNotifiedVersion = version;
        Logger.Info($"Update available on the server: {version} (running {Program.AppVersion}).");
        UpdateAvailable?.Invoke(info);
        return true;
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
