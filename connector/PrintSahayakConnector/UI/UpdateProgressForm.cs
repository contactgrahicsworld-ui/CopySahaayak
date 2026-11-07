namespace PrintSahayakConnector.UI;

/// <summary>
/// Small always-on-top progress window for the one-click self-update. Hindi-first
/// copy so a shop owner who cannot read English still understands every step:
/// download percentage, then "installing", with a single cancel button.
/// </summary>
internal sealed class UpdateProgressForm : Form
{
    private readonly Label _title = new();
    private readonly Label _detail = new();
    private readonly ProgressBar _bar = new();
    private readonly Button _cancel = new();

    /// <summary>Cancellation for the running download (cancel button wires into this).</summary>
    public CancellationTokenSource Cts { get; } = new();

    public UpdateProgressForm(string version)
    {
        Text = Program.AppTitle;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ClientSize = new Size(430, 150);
        Font = new Font("Segoe UI", 10F);

        _title.Text = $"नया वर्जन {version} डाउनलोड हो रहा है…";
        _title.Location = new Point(18, 15);
        _title.Size = new Size(394, 26);
        _title.Font = new Font("Segoe UI", 11F, FontStyle.Bold);

        _detail.Text = "जुड़ रहा है…";
        _detail.Location = new Point(18, 45);
        _detail.Size = new Size(394, 22);
        _detail.ForeColor = SystemColors.GrayText;

        _bar.Location = new Point(18, 72);
        _bar.Size = new Size(394, 22);
        _bar.Minimum = 0;
        _bar.Maximum = 100;

        _cancel.Text = "रद्द करो (Cancel)";
        _cancel.Location = new Point(18, 104);
        _cancel.Size = new Size(150, 32);
        _cancel.Click += (_, _) =>
        {
            Cts.Cancel();
            Close();
        };

        Controls.AddRange(new Control[] { _title, _detail, _bar, _cancel });
    }

    /// <summary>Shows 0..1 progress as percent plus downloaded/total megabytes.</summary>
    public void SetProgress(double fraction, long totalBytes)
    {
        if (IsDisposed) return;
        var pct = Math.Clamp((int)Math.Round(fraction * 100), 0, 100);
        _bar.Value = pct;
        _detail.Text = totalBytes > 0
            ? $"{pct}% ({FormatMb((long)(fraction * totalBytes))} / {FormatMb(totalBytes)})"
            : $"{pct}%";
    }

    /// <summary>Switches the window to "installing" mode (marquee, cancel disabled).</summary>
    public void SetInstalling()
    {
        if (IsDisposed) return;
        _title.Text = "इंस्टॉल हो रहा है…";
        _detail.Text = "ऐप कुछ सेकंड में खुद दोबारा शुरू हो जाएगा।";
        _bar.Style = ProgressBarStyle.Marquee;
        _bar.MarqueeAnimationSpeed = 40;
        _cancel.Enabled = false;
    }

    private static string FormatMb(long bytes) => $"{bytes / (1024.0 * 1024.0):0.0} MB";
}
