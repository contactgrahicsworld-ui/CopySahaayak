using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.UI;

/// <summary>
/// Non-modal status window shown from the tray menu / double click. It displays the
/// paired shop, this device, the worker state (including pending activity such as
/// downloading / printing / reporting), the last heartbeat and the last job check.
/// A one second timer re-renders the "…" ago suffixes; live updates arrive via
/// <see cref="UpdateStatus"/> (pushed by the tray context on every status change).
/// </summary>
public sealed class StatusForm : Form
{
    private readonly LocalStore _store;
    private readonly Func<WorkerStatus?> _getStatus;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };

    private readonly Label _shopValue = new();
    private readonly Label _deviceValue = new();
    private readonly Label _serverValue = new();
    private readonly Label _machineValue = new();
    private readonly Label _autoStartValue = new();
    private readonly Label _stateValue = new();
    private readonly Label _printersValue = new();
    private readonly Label _activityValue = new();
    private readonly Label _heartbeatValue = new();
    private readonly Label _checkValue = new();
    private readonly Button _openLogsButton = new();
    private readonly Button _closeButton = new();

    /// <summary>Creates the status window; <paramref name="getStatus"/> supplies the latest worker snapshot.</summary>
    public StatusForm(LocalStore store, Func<WorkerStatus?> getStatus)
    {
        _store = store;
        _getStatus = getStatus;

        Text = "Status";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(520, 342);
        Icon = TryLoadIcon();

        var layout = new TableLayoutPanel
        {
            Location = new Point(16, 16),
            Size = new Size(488, 256),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
            ColumnCount = 2,
            RowCount = 10,
            AutoSize = true,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        AddRow(layout, "Shop", _shopValue);
        AddRow(layout, "Device", _deviceValue);
        AddRow(layout, "Server", _serverValue);
        AddRow(layout, "This computer", _machineValue);
        AddRow(layout, "Start with Windows", _autoStartValue);
        AddRow(layout, "Connection", _stateValue);
        AddRow(layout, "Printers configured", _printersValue);
        AddRow(layout, "Pending activity", _activityValue);
        AddRow(layout, "Last heartbeat", _heartbeatValue);
        AddRow(layout, "Last job check", _checkValue);

        _openLogsButton.Text = "Open Logs";
        _openLogsButton.Size = new Size(104, 28);
        _openLogsButton.Location = new Point(16, 296);
        _openLogsButton.UseVisualStyleBackColor = true;
        _openLogsButton.Click += (_, _) => Logger.OpenLogFolder();

        _closeButton.Text = "Close";
        _closeButton.Size = new Size(88, 28);
        _closeButton.Location = new Point(416, 296);
        _closeButton.UseVisualStyleBackColor = true;
        _closeButton.Click += (_, _) => Close();
        CancelButton = _closeButton;

        Controls.AddRange(new Control[] { layout, _openLogsButton, _closeButton });

        _timer.Tick += (_, _) => Apply(_getStatus());
        FormClosed += (_, _) => _timer.Dispose();

        Apply(_getStatus());
        _timer.Start();
    }

    private static Icon? TryLoadIcon()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            return string.IsNullOrEmpty(exePath) ? null : Icon.ExtractAssociatedIcon(exePath);
        }
        catch
        {
            return null;
        }
    }

    private static void AddRow(TableLayoutPanel layout, string caption, Label value)
    {
        var captionLabel = new Label
        {
            Text = caption,
            AutoSize = true,
            Margin = new Padding(0, 3, 8, 3),
            ForeColor = SystemColors.GrayText,
        };
        value.AutoSize = true;
        value.Margin = new Padding(0, 3, 0, 3);
        value.Text = "…";
        layout.Controls.Add(captionLabel);
        layout.Controls.Add(value);
        layout.SetColumn(value, 1);
    }

    /// <summary>Called by the tray context whenever the worker reports a new status.</summary>
    public void UpdateStatus(WorkerStatus status) => Apply(status);

    private void Apply(WorkerStatus? status)
    {
        if (IsDisposed) return;

        _shopValue.Text = _store.IsPaired
            ? $"{_store.ShopName ?? "(unknown)"} ({_store.ShopSlug ?? "—"})"
            : "Not paired";
        _deviceValue.Text = _store.IsPaired
            ? $"{_store.MachineName ?? Environment.MachineName} (id {_store.DeviceId ?? "—"})"
            : "—";
        _serverValue.Text = string.IsNullOrEmpty(_store.ServerUrl) ? "—" : _store.ServerUrl;
        _machineValue.Text = Environment.MachineName;
        _autoStartValue.Text = AutoStart.IsEnabled() ? "Enabled" : "Disabled";

        if (status is null)
        {
            _stateValue.Text = _store.IsPaired ? "Starting…" : "Not paired";
            _stateValue.ForeColor = SystemColors.ControlText;
            _printersValue.Text = _store.IsPaired ? $"{_store.GetPrinters().Count}" : "—";
            _printersValue.ForeColor = SystemColors.ControlText;
            _activityValue.Text = "—";
            _heartbeatValue.Text = "Never";
            _checkValue.Text = "Never";
            return;
        }

        _stateValue.Text = DescribeState(status.State);
        _stateValue.ForeColor = status.State switch
        {
            WorkerState.Revoked => Color.Firebrick,
            WorkerState.Backoff => Color.DarkOrange,
            WorkerState.Downloading or WorkerState.Printing or WorkerState.Reporting => Color.ForestGreen,
            _ => SystemColors.ControlText,
        };

        var mapped = _store.GetPrinters().Count;
        _printersValue.Text = mapped == 0
            ? "NONE — open Printer Settings… and tick at least one printer"
            : $"{mapped} ready to receive jobs";
        _printersValue.ForeColor = mapped == 0 && _store.IsPaired ? Color.Firebrick : SystemColors.ControlText;

        _activityValue.Text = string.IsNullOrWhiteSpace(status.Detail) ? "—" : status.Detail;
        _heartbeatValue.Text = DescribeTime(status.LastHeartbeatUtc);
        _checkValue.Text = DescribeTime(status.LastCheckUtc);
    }

    private static string DescribeState(WorkerState state) => state switch
    {
        WorkerState.NotPaired => "Not paired",
        WorkerState.Waiting => "Connected — watching for jobs",
        WorkerState.Downloading => "Connected — downloading a job",
        WorkerState.Printing => "Connected — printing",
        WorkerState.Reporting => "Connected — reporting job result",
        WorkerState.Backoff => "Connection problem — retrying",
        WorkerState.Revoked => "Revoked by the shop admin",
        WorkerState.Stopped => "Stopped",
        _ => state.ToString(),
    };

    private static string DescribeTime(DateTime? utc)
    {
        if (utc is null) return "Never";
        var local = utc.Value.ToLocalTime();
        var ago = DateTime.UtcNow - utc.Value;
        return ago.TotalSeconds < 1
            ? $"{local:HH:mm:ss} (just now)"
            : ago.TotalMinutes < 1
                ? $"{local:HH:mm:ss} ({ago.TotalSeconds:0}s ago)"
                : $"{local:HH:mm:ss} ({ago.TotalMinutes:0} min ago)";
    }
}
