using PrintSahayakConnector.Api;
using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.UI;

/// <summary>
/// The whole application lives in this <see cref="ApplicationContext"/>: tray icon
/// and menu, worker lifecycle, pairing dialog, printer mapping, status window and
/// the one-click self-update.
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
    private UpdateChecker? _updater;

    // --- self-update state (all touched on the UI thread only) -----------------
    private UpdateInfo? _pendingUpdate;      // newest version waiting for a click
    private bool _updateBusy;                // download/install in progress
    private bool _updateDeferred;            // printer was busy; start once idle
    private UpdateProgressForm? _progressForm;

    /// <summary>Prepares the tray icon and starts the worker (or the pairing dialog on first run).</summary>
    public TrayContext(string? deepLink)
    {
        _uiContext = SynchronizationContext.Current;
        Directory.CreateDirectory(Logger.AppDataRoot);
        _store = new LocalStore(Path.Combine(Logger.AppDataRoot, "state.db"));

        BuildTrayIcon();
        SelfUpdater.CleanStaleDownloads();
        NotifyIfUpdated();

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
        menu.Items.Add("अपडेट चेक करो (Check for Updates)", null, (_, _) => _ = ManualUpdateCheckAsync());
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
        _tray.BalloonTipClicked += (_, _) => BeginInteractiveUpdate();
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
        StartUpdateChecker(api);
        Logger.Info($"Worker started (device {_store.DeviceId}, shop {_store.ShopName}).");
    }

    private void OnWorkerStatusChanged(WorkerStatus status)
    {
        PostToUi(() =>
        {
            UpdateTrayText(status);
            _statusForm?.UpdateStatus(status);

            // The user already asked for the update but a job was printing —
            // start it automatically the moment the printer is free again.
            if (_updateDeferred && !_updateBusy && _pendingUpdate != null &&
                !IsJobRunning(status.State))
            {
                _updateDeferred = false;
                StartUpdateDownload(_pendingUpdate);
            }
        });
    }

    private static bool IsJobRunning(WorkerState state) =>
        state is WorkerState.Downloading or WorkerState.Printing or WorkerState.Reporting;

    private void OnWorkerNotify(string message, BalloonKind kind)
    {
        PostToUi(() =>
        {
            _tray.ShowBalloonTip(
                6000,
                Program.AppTitle,
                message,
                kind == BalloonKind.Error ? ToolTipIcon.Error : ToolTipIcon.Info);
        });
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
            StartUpdateChecker(api); // re-pair may point at a different server
        }

        _tray.ShowBalloonTip(
            6000,
            Program.AppTitle,
            $"Paired with “{_store.ShopName}”. Now choose your printers.",
            ToolTipIcon.Info);
        UpdateTrayText(_worker!.Status);

        // The shop cannot receive a single job until printers are mapped — open the
        // printer settings right away instead of hoping the user finds the tray menu.
        ShowPrinterMapping();
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

    /// <summary>Number of printers currently mapped for jobs (shown in the status window).</summary>
    public int MappedPrinterCount => _store.GetPrinters().Count;

    private void StartUpdateChecker(ApiClient api)
    {
        _updater?.Dispose();
        _updater = new UpdateChecker(api);
        _updater.UpdateAvailable += OnUpdateAvailable;
        _updater.Start();
    }

    // ---------------------------------------------------------------------------
    // Self-update: notification → one click → download → checksum → install →
    // automatic restart. The shop owner never visits a website or runs a file.
    // ---------------------------------------------------------------------------

    private void OnUpdateAvailable(UpdateInfo info)
    {
        PostToUi(() =>
        {
            _pendingUpdate = info;
            _tray.ShowBalloonTip(
                12000,
                Program.AppTitle,
                $"नया वर्जन {info.Version} आ गया — इस सूचना पर क्लिक करो।\n" +
                "ऐप खुद डाउनलोड करके अपडेट हो जाएगा।\n" +
                $"(New version {info.Version} — click here and the app updates itself.)",
                ToolTipIcon.Info);
        });
    }

    /// <summary>Runs on the UI thread when an update balloon is clicked.</summary>
    private void BeginInteractiveUpdate()
    {
        var info = _pendingUpdate;
        if (info == null) return; // some other balloon

        if (_updateBusy)
        {
            _progressForm?.Activate();
            return;
        }

        // Never interrupt a running print job.
        if (IsJobRunning(_worker?.Status.State ?? WorkerState.Waiting))
        {
            _updateDeferred = true;
            _tray.ShowBalloonTip(
                8000,
                Program.AppTitle,
                "अभी प्रिंट हो रहा है — प्रिंट खत्म होते ही अपडेट खुद शुरू हो जाएगा।\n" +
                "(A print job is running — the update starts by itself when it finishes.)",
                ToolTipIcon.Info);
            return;
        }

        var choice = MessageBox.Show(
            $"नया वर्जन {info.Version} डाउनलोड और इंस्टॉल करें?\n\n" +
            "ऐप खुद डाउनलोड करेगा, इंस्टॉल करेगा और दोबारा शुरू हो जाएगा।\n" +
            "(Download and install the new version now? The app does everything and restarts itself.)",
            Program.AppTitle,
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button1);
        if (choice != DialogResult.Yes) return;

        StartUpdateDownload(info);
    }

    /// <summary>Starts the download in the background and shows the progress window.</summary>
    private void StartUpdateDownload(UpdateInfo info)
    {
        if (_updateBusy || _api == null) return;
        _updateBusy = true;

        var api = _api;
        var isSetup = SelfUpdater.IsInstalledBuild();
        var fileName = isSetup
            ? $"DesktopSahaayak-Setup-{info.Version}.exe"
            : $"DesktopSahaayak-{info.Version}.exe";
        string dest;
        try
        {
            Directory.CreateDirectory(SelfUpdater.UpdateDir);
            dest = Path.Combine(SelfUpdater.UpdateDir, fileName);
        }
        catch (Exception ex)
        {
            FailUpdate("अपडेट फाइल सेव नहीं हो पाई।", ex);
            return;
        }

        var form = new UpdateProgressForm(info.Version ?? "?");
        _progressForm = form;
        form.Show();

        // Created on the UI thread: progress callbacks marshal back here automatically.
        var progress = new Progress<double>(f =>
        {
            try { form.SetProgress(f, info.SizeBytes ?? 0); }
            catch { /* the window may already be closing */ }
        });

        Task.Run(async () =>
        {
            try
            {
                Logger.Info($"Downloading update {info.Version} from {info.DownloadUrl} …");
                var total = await api.DownloadToFileAsync(info.DownloadUrl!, dest, progress, form.Cts.Token);
                Logger.Info($"Update downloaded ({total} bytes); verifying checksum…");
                SelfUpdater.VerifySha256(dest, info.Sha256);
                Logger.Info("Checksum OK; starting the install…");
                PostToUi(() => form.SetInstalling());

                if (isSetup)
                {
                    // Give an in-flight job a chance to finish before the installer
                    // force-stops the connector (it does the same itself, but a
                    // graceful exit keeps the logs and state.db clean).
                    if (!await WaitForIdleAsync(form.Cts.Token, TimeSpan.FromMinutes(15)))
                    {
                        throw new TimeoutException("A print job did not finish within 15 minutes.");
                    }

                    if (!SelfUpdater.RunSetupInstaller(dest))
                    {
                        PostToUi(() =>
                        {
                            _updateBusy = false;
                            CloseProgressForm();
                            _tray.ShowBalloonTip(
                                8000, Program.AppTitle,
                                "अपडेट रद्द कर दिया गया — दोबारा करने के लिए सूचना पर फिर क्लिक करो।\n" +
                                "(Update cancelled — click the notification again to retry.)",
                                ToolTipIcon.Info);
                        });
                        return;
                    }

                    Logger.Info("Installer launched; exiting so the files can be replaced.");
                    PostToUi(ExitForUpdate);
                    return;
                }

                // Portable build: swap the exe and restart via the cmd helper.
                SelfUpdater.InstallPortable(dest);
                PostToUi(ExitForUpdate);
            }
            catch (OperationCanceledException)
            {
                Logger.Info("Update download cancelled by the user.");
                PostToUi(() =>
                {
                    _updateBusy = false;
                    CloseProgressForm();
                });
            }
            catch (TimeoutException)
            {
                Logger.Warn("Update postponed: a print job did not finish within 15 minutes.");
                PostToUi(() =>
                {
                    _updateBusy = false;
                    _updateDeferred = false;
                    CloseProgressForm();
                    _tray.ShowBalloonTip(
                        10000, Program.AppTitle,
                        "प्रिंट अभी भी चल रहा है — अपडेट रुक गया। बाद में फिर कोशिश करो।\n" +
                        "(The print job kept running — the update was paused. Try again later.)",
                        ToolTipIcon.Info);
                });
            }
            catch (Exception ex)
            {
                Logger.Error("Self-update failed.", ex);
                FailUpdate("अपडेट नहीं हो पाया — इंटरनेट देखो और दोबारा कोशिश करो।", ex);
            }
        });
    }

    /// <summary>Waits until no job is printing (checked from a background thread).</summary>
    private async Task<bool> WaitForIdleAsync(CancellationToken ct, TimeSpan maxWait)
    {
        var deadline = DateTime.UtcNow + maxWait;
        while (DateTime.UtcNow < deadline)
        {
            if (!IsJobRunning(_worker?.Status.State ?? WorkerState.Waiting)) return true;
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        }

        return !IsJobRunning(_worker?.Status.State ?? WorkerState.Waiting);
    }

    /// <summary>Tears down the progress window, reports the failure and re-arms the update.</summary>
    private void FailUpdate(string hindiMessage, Exception ex)
    {
        Logger.Error("Update step failed.", ex);
        PostToUi(() =>
        {
            _updateBusy = false;
            _updateDeferred = false;
            CloseProgressForm();
            _tray.ShowBalloonTip(
                10000, Program.AppTitle,
                hindiMessage + "\n(Update failed — try again after checking the internet.)",
                ToolTipIcon.Error);
        });
    }

    private void CloseProgressForm()
    {
        try { _progressForm?.Close(); }
        catch { /* already closing */ }
        _progressForm = null;
    }

    /// <summary>Exits so the installer can replace files; it restarts the connector.</summary>
    private void ExitForUpdate() => Exit();

    /// <summary>Tray menu "Check for Updates": always answers with a clear balloon.</summary>
    private async Task ManualUpdateCheckAsync()
    {
        if (_updater == null || _api == null)
        {
            _tray.ShowBalloonTip(
                6000, Program.AppTitle,
                "पहले दुकान से पेयर करो — अपडेट पेयरिंग के बाद मिलता है।\n" +
                "(Pair with your shop first — updates come after pairing.)",
                ToolTipIcon.Info);
            return;
        }

        try
        {
            var raised = await _updater.CheckOnceAsync(force: true);
            if (raised) return; // the update balloon is already on screen

            var info = await _api.GetLatestVersionAsync();
            _tray.ShowBalloonTip(
                6000, Program.AppTitle,
                info == null
                    ? "सर्वर से बात नहीं हो पाई — इंटरनेट देखो।\n(Could not reach the server — check the internet.)"
                    : $"आपका ऐप लेटेस्ट वर्जन पर है ✓ (वर्जन {Program.AppVersion})\n(Your app is up to date.)",
                ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Manual update check failed: {ex.Message}");
        }
    }

    /// <summary>First run after an update: a short "अपडेट हो गया ✓" confirmation.</summary>
    private void NotifyIfUpdated()
    {
        try
        {
            var marker = Path.Combine(Logger.AppDataRoot, "lastVersion.txt");
            var previous = File.Exists(marker) ? File.ReadAllText(marker).Trim() : string.Empty;
            File.WriteAllText(marker, Program.AppVersion);
            if (!string.IsNullOrEmpty(previous) &&
                !previous.Equals(Program.AppVersion, StringComparison.OrdinalIgnoreCase))
            {
                _tray.ShowBalloonTip(
                    8000, Program.AppTitle,
                    $"अपडेट हो गया ✓ अब वर्जन {Program.AppVersion} चल रहा है।\n" +
                    $"(Update done — now running version {Program.AppVersion}.)",
                    ToolTipIcon.Info);
            }
        }
        catch (Exception ex)
        {
            Logger.Debug($"Version marker skipped: {ex.Message}");
        }
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
            _updater?.Dispose();
            _updater = null;
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
