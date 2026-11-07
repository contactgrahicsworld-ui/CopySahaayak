using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.UI;

/// <summary>
/// Non-modal status window shown from the tray menu / double click. It displays the
/// paired shop, this device, the worker state (including pending activity such as
/// downloading / printing / reporting), the last heartbeat and the last job check —
/// plus the “अब क्या छप रहा है” (now printing) card: the claimed job's details and a
/// rendered preview of its first page.
/// A one second timer re-renders the "…" ago suffixes; live updates arrive via
/// <see cref="UpdateStatus"/> and <see cref="UpdateNowPrinting"/> (pushed by the
/// tray context on every worker event).
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

    // --- "now printing" preview card -----------------------------------------
    private readonly GroupBox _nowGroup = new();
    private readonly PictureBox _previewBox = new();
    private readonly Label _nowTitle = new();
    private readonly Label _nowMeta = new();
    private readonly Label _nowPrinter = new();
    private NowPrinting? _now;

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
        ClientSize = new Size(560, 620);
        Icon = TryLoadIcon();

        var layout = new TableLayoutPanel
        {
            Location = new Point(16, 16),
            Size = new Size(528, 250),
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

        BuildNowPrintingCard();

        _openLogsButton.Text = "Open Logs";
        _openLogsButton.Size = new Size(104, 28);
        _openLogsButton.Location = new Point(16, 570);
        _openLogsButton.UseVisualStyleBackColor = true;
        _openLogsButton.Click += (_, _) => Logger.OpenLogFolder();

        _closeButton.Text = "Close";
        _closeButton.Size = new Size(88, 28);
        _closeButton.Location = new Point(456, 570);
        _closeButton.UseVisualStyleBackColor = true;
        _closeButton.Click += (_, _) => Close();
        CancelButton = _closeButton;

        Controls.AddRange(new Control[] { layout, _nowGroup, _openLogsButton, _closeButton });

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

    /// <summary>Builds the “अब क्या छप रहा है” card: preview image + job details.</summary>
    private void BuildNowPrintingCard()
    {
        _nowGroup.Text = "अब क्या छप रहा है (Now Printing)";
        _nowGroup.Location = new Point(16, 274);
        _nowGroup.Size = new Size(528, 284);
        _nowGroup.Font = new Font("Segoe UI", 9.75f, FontStyle.Bold);

        _previewBox.Location = new Point(16, 26);
        _previewBox.Size = new Size(200, 244);
        _previewBox.SizeMode = PictureBoxSizeMode.Zoom;
        _previewBox.BorderStyle = BorderStyle.FixedSingle;
        _previewBox.BackColor = Color.White;
        _previewBox.Visible = false;

        _nowTitle.AutoSize = false;
        _nowTitle.Location = new Point(228, 26);
        _nowTitle.Size = new Size(284, 44);
        _nowTitle.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        _nowTitle.Text = "—";

        _nowMeta.AutoSize = false;
        _nowMeta.Location = new Point(228, 74);
        _nowMeta.Size = new Size(284, 110);
        _nowMeta.Font = new Font("Segoe UI", 9f);
        _nowMeta.ForeColor = SystemColors.ControlText;
        _nowMeta.Text = "—";

        _nowPrinter.AutoSize = false;
        _nowPrinter.Location = new Point(228, 188);
        _nowPrinter.Size = new Size(284, 26);
        _nowPrinter.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
        _nowPrinter.ForeColor = Color.ForestGreen;
        _nowPrinter.Text = "—";

        _nowGroup.Controls.AddRange(new Control[] { _previewBox, _nowTitle, _nowMeta, _nowPrinter });
    }

    /// <summary>Called by the tray context whenever the worker reports a new status.</summary>
    public void UpdateStatus(WorkerStatus status) => Apply(status);

    /// <summary>Called by the tray context when a new job was claimed and starts printing.</summary>
    public void UpdateNowPrinting(NowPrinting now)
    {
        if (IsDisposed) return;
        _now = now;
        RenderNowCard("🖨️ छप रहा है…", Color.ForestGreen);
    }

    private void RenderNowCard(string headline, Color headlineColor)
    {
        if (_now is not { } now)
        {
            return;
        }

        _nowGroup.Visible = true;
        _nowTitle.Text = headline + "\n" + (string.IsNullOrWhiteSpace(now.OrderNumber) ? now.JobId : now.OrderNumber);
        _nowTitle.ForeColor = headlineColor;

        var paper = string.IsNullOrWhiteSpace(now.PaperSize) ? null : now.PaperSize;
        _nowMeta.Text =
            $"फ़ाइल: {now.FileName}\n" +
            $"पेज: {(now.Pages > 0 ? now.Pages.ToString() : "—")} × {now.Copies} कॉपी\n" +
            $"रंग: {DescribeColor(now.ColorMode)}{(paper != null ? $" · पेपर: {paper}" : "")}{(now.Duplex ? " · duplex" : "")}";

        _nowPrinter.Text = $"प्रिंटर: {now.PrinterName}";

        if (now.PreviewPng is { Length: > 0 })
        {
            try
            {
                using var ms = new MemoryStream(now.PreviewPng);
                var previous = _previewBox.Image;
                _previewBox.Image = System.Drawing.Image.FromStream(ms);
                previous?.Dispose();
                _previewBox.Visible = true;
            }
            catch
            {
                _previewBox.Visible = false;
            }
        }
        else
        {
            _previewBox.Visible = false;
        }
    }

    private static string DescribeColor(string colorMode) => colorMode?.ToUpperInvariant() switch
    {
        "COLOR" => "Colour",
        "BW" => "Black & White",
        _ => "Any",
    };

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
            ? "कोई नहीं — Printer Settings… खोलकर कम से कम एक प्रिंटर ✓ करो"
            : $"{mapped} तैयार — काम छपेगा (ready to receive jobs)";
        _printersValue.ForeColor = mapped == 0 && _store.IsPaired ? Color.Firebrick : SystemColors.ControlText;

        _activityValue.Text = string.IsNullOrWhiteSpace(status.Detail) ? "—" : status.Detail;
        _heartbeatValue.Text = DescribeTime(status.LastHeartbeatUtc);
        _checkValue.Text = DescribeTime(status.LastCheckUtc);

        // Keep the last job visible with its outcome until the next job starts.
        if (_now != null)
        {
            if (status.State == WorkerState.Waiting && status.Detail?.StartsWith("Completed ") == true)
            {
                RenderNowCard("✓ छप गया", Color.ForestGreen);
            }
            else if (status.State == WorkerState.Waiting && (status.Detail?.Contains("failed") == true || status.Detail?.Contains("Failed") == true))
            {
                RenderNowCard("✗ छपने में समस्या", Color.Firebrick);
            }
        }
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
