using PrintSahayakConnector.Api;
using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.UI;

/// <summary>
/// The whole application lives in this <see cref="ApplicationContext"/>: tray icon
/// and menu, worker lifecycle, pairing dialog, printer mapping and status window.
/// </summary>
public sealed class TrayContext : ApplicationContext
{
    private readonly LocalStore _store;
    private readonly SynchronizationContext? _uiContext;
    private readonly CancellationTokenSource _shutdownCts = new();

    private NotifyIcon _tray = null!;
    private JobWorker? _worker;
    private ApiClient? _api;
    private PairingForm? _pairingForm;
    private PrinterMappingForm? _mappingForm;
    private StatusForm? _statusForm;

    /// <summary>Prepares the tray icon and starts the worker (or the pairing dialog on first run).</summary>
    public TrayContext(string? deepLink)
    {
        _uiContext = SynchronizationContext.Current;
        Directory.CreateDirectory(Logger.AppDataRoot);
        _store = new LocalStore(Path.Combine(Logger.AppDataRoot, "state.db"));

        BuildTrayIcon();

        var link = DeepLinkParser.Parse(deepLink);
        if (_store.IsPaired)
        {
            StartWorker();
        }
        else
        {
            ShowPairing(link);
        }

        _ = Task.Run(() => WatchPairingHintsAsync(_shutdownCts.Token));
        Application.ApplicationExit += (_, _) => _shutdownCts.Cancel();
    }

    private void BuildTrayIcon()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Status…", null, (_, _) => ShowStatus());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Printer Settings…", null, (_, _) => ShowPrinterMapping());
        menu.Items.Add("Pair with Shop…", null, (_, _) => ShowPairing(null));
        menu.Items.Add("Open Logs", null, (_, _) => Logger.OpenLogFolder());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Check for Jobs Now", null, (_, _) => _worker?.CheckNow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Exit());

        _tray = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "Desktop Sahaayak",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => ShowStatus();
    }

    private static Icon LoadTrayIcon()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exePath))
            {
                return Icon.ExtractAssociatedIcon(exePath) ?? SystemIcons.Application;
            }
        }
        catch (Exception ex)
        {
            Logger.Warn("Could not load the app icon: " + ex.Message);
        }

        return SystemIcons.Application;
    }

    private void StartWorker()
    {
        var api = new ApiClient(_store.ServerUrl!);
        api.SetDeviceToken(_store.DeviceToken);
        _api = api;

        _worker = new JobWorker(_store, api);
        _worker.StatusChanged += OnWorkerStatusChanged;
        _worker.NotifyUser += OnWorkerNotify;
        _worker.Start();
        Logger.Info($"Worker started (device {_store.DeviceId}, shop {_store.ShopName}).");
    }

    private void OnWorkerStatusChanged(WorkerStatus status)
    {
        PostToUi(() =>
        {
            UpdateTrayText(status);
            _statusForm?.UpdateStatus(status);
        });
    }

    private void OnWorkerNotify(string message, BalloonKind kind)
    {
        PostToUi(() => _tray.ShowBalloonTip(
            6000,
            Program.AppTitle,
            message,
            kind == BalloonKind.Error ? ToolTipIcon.Error : ToolTipIcon.Info));
    }

    private void PostToUi(Action action)
    {
        var context = _uiContext;
        if (context == null) action();
        else context.Post(_ => action(), null);
    }

    private void UpdateTrayText(WorkerStatus status)
    {
        var shop = _store.ShopName ?? "not paired";
        var text = status.State switch
        {
            WorkerState.Downloading or WorkerState.Printing or WorkerState.Reporting => $"{shop}: {status.Detail}",
            WorkerState.Revoked => $"{shop}: revoked — pair again",
            WorkerState.NotPaired => "Not paired",
            WorkerState.Backoff => $"{shop}: offline, retrying…",
            WorkerState.Stopped => "Stopped",
            _ => $"{shop}: watching for jobs",
        };
        if (text.Length > 63) text = text[..60] + "…"; // NotifyIcon tooltip limit
        _tray.Text = text;
    }

    private void ShowPairing(PairingLink? prefill)
    {
        PostToUi(() =>
        {
            if (_pairingForm is { IsDisposed: false })
            {
                _pairingForm.Activate();
                return;
            }

            _pairingForm = new PairingForm(_store, prefill);
            _pairingForm.Paired += OnPaired;
            _pairingForm.FormClosed += (_, _) => _pairingForm = null;
            _pairingForm.Show();
        });
    }

    private void OnPaired()
    {
        var form = _pairingForm;
        _pairingForm = null;
        if (form is { IsDisposed: false }) form.Close();

        if (_worker == null)
        {
            StartWorker();
        }
        else
        {
            var api = new ApiClient(_store.ServerUrl!);
            api.SetDeviceToken(_store.DeviceToken);
            _worker.RestartWith(api);
            _api = api;
        }

        _tray.ShowBalloonTip(
            6000,
            Program.AppTitle,
            $"Paired with “{_store.ShopName}”. Print jobs will show up here.",
            ToolTipIcon.Info);
        UpdateTrayText(_worker!.Status);
    }

    private void ShowPrinterMapping()
    {
        if (_mappingForm is { IsDisposed: false })
        {
            _mappingForm.Activate();
            return;
        }

        _mappingForm = new PrinterMappingForm(_store);
        // Saved mappings are pushed to the server immediately via a fresh heartbeat.
        _mappingForm.Saved += () => _worker?.CheckNow();
        _mappingForm.FormClosed += (_, _) => _mappingForm = null;
        _mappingForm.Show();
    }

    private void ShowStatus()
    {
        if (_statusForm is { IsDisposed: false })
        {
            _statusForm.Activate();
            return;
        }

        _statusForm = new StatusForm(_store, () => _worker?.Status);
        _statusForm.FormClosed += (_, _) => _statusForm = null;
        _statusForm.Show();
    }

    private void Exit()
    {
        try
        {
            _shutdownCts.Cancel();
            _worker?.Dispose();
            _worker = null;
            _api?.Dispose();
            _api = null;
            _tray.Visible = false;
            _tray.Dispose();
        }
        catch (Exception ex)
        {
            Logger.Error("Error during shutdown.", ex);
        }
        finally
        {
            Application.Exit();
        }
    }

    private async Task WatchPairingHintsAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var raw = await PairingHint.WaitForLinkAsync(ct);
            if (raw == null) break;

            var link = DeepLinkParser.Parse(raw);
            if (link == null) continue;

            Logger.Info("Received a pairing deep link from a second launch.");
            ShowPairing(link);
        }
    }
}
