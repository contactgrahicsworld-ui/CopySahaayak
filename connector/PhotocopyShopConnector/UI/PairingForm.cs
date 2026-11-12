using System.Net;
using PhotocopyShopConnector.Api;
using PhotocopyShopConnector.Core;

namespace PhotocopyShopConnector.UI;

/// <summary>
/// First-run / re-pairing dialog: server URL, 6-character pairing code, machine
/// name and the "start with Windows" preference. All fields can be prefilled with
/// a <c>photocopyconnector://pair?server=…&amp;code=…</c> deep link (parsed by
/// <see cref="DeepLinkParser"/>) so shop admins can hand out one-click pairing links.
/// On success the token/server are persisted via <see cref="LocalStore"/>, the HKCU
/// Run key is updated through <see cref="AutoStart"/> and the <see cref="Paired"/>
/// event is raised (the tray context then starts/restarts the worker).
/// </summary>
public sealed class PairingForm : Form
{
    /// <summary>Status codes the server uses for an invalid / expired / revoked pairing code.</summary>
    private static readonly HttpStatusCode[] AuthoritativeCodeErrors =
    {
        HttpStatusCode.BadRequest,
        HttpStatusCode.Unauthorized,
        HttpStatusCode.Forbidden,
        HttpStatusCode.NotFound,
        HttpStatusCode.Gone,
    };

    private readonly LocalStore _store;

    private readonly TextBox _serverBox = new();
    private readonly TextBox _codeBox = new();
    private readonly TextBox _machineBox = new();
    private readonly CheckBox _autoStartBox = new();
    private readonly Button _pairButton = new();
    private readonly Button _closeButton = new();
    private readonly Label _messageLabel = new();

    /// <summary>Raised on the UI thread after a successful pairing (the store is already updated).</summary>
    public event Action? Paired;

    /// <summary>Creates the pairing dialog; <paramref name="prefill"/> comes from a deep link (optional).</summary>
    public PairingForm(LocalStore store, PairingLink? prefill)
    {
        _store = store;

        Text = "Pair with Shop";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(460, 320);
        Icon = TryLoadIcon();

        var intro = new Label
        {
            Text = "Connect this computer to your Photocopy Shop dashboard.\r\n" +
                   "Get a fresh pairing code from the dashboard: Devices → Pair a device.",
            Location = new Point(16, 14),
            Size = new Size(428, 40),
        };

        var serverCaption = MakeCaption("Shop server URL", 64);
        _serverBox.Location = new Point(16, 82);
        _serverBox.Size = new Size(428, 23);
        _serverBox.Text = prefill?.ServerUrl ?? "https://";

        var codeCaption = MakeCaption("Pairing code (6 characters)", 112);
        _codeBox.Location = new Point(16, 130);
        _codeBox.Size = new Size(160, 30);
        _codeBox.MaxLength = 6;
        _codeBox.CharacterCasing = CharacterCasing.Upper;
        _codeBox.TextAlign = HorizontalAlignment.Center;
        _codeBox.Font = new Font("Consolas", 13f, FontStyle.Bold);
        _codeBox.Text = prefill?.PairingCode ?? string.Empty;

        var machineCaption = MakeCaption("Name of this computer (shown in the dashboard)", 168);
        _machineBox.Location = new Point(16, 186);
        _machineBox.Size = new Size(428, 23);
        _machineBox.Text = Environment.MachineName;
        _machineBox.MaxLength = 64;

        _autoStartBox.Text = "Start the connector automatically with Windows";
        _autoStartBox.Location = new Point(16, 216);
        _autoStartBox.Size = new Size(428, 22);
        _autoStartBox.Checked = _store.IsPaired ? AutoStart.IsEnabled() : true;

        _pairButton.Text = "Pair";
        _pairButton.Location = new Point(268, 272);
        _pairButton.Size = new Size(88, 28);
        _pairButton.UseVisualStyleBackColor = true;
        _pairButton.Click += (_, _) => _ = PairAsync();

        _closeButton.Text = "Cancel";
        _closeButton.Location = new Point(360, 272);
        _closeButton.Size = new Size(84, 28);
        _closeButton.UseVisualStyleBackColor = true;
        _closeButton.Click += (_, _) => Close();

        _messageLabel.Location = new Point(16, 246);
        _messageLabel.Size = new Size(428, 20);
        _messageLabel.ForeColor = Color.Firebrick;
        _messageLabel.Visible = false;

        AcceptButton = _pairButton;
        CancelButton = _closeButton;

        Controls.AddRange(new Control[]
        {
            intro,
            serverCaption, _serverBox,
            codeCaption, _codeBox,
            machineCaption, _machineBox,
            _autoStartBox,
            _messageLabel,
            _pairButton, _closeButton,
        });

        if (prefill != null && _codeBox.Text.Length == 6)
        {
            _machineBox.Focus();
            _machineBox.SelectAll();
        }
        else
        {
            _codeBox.Focus();
        }
    }

    private Label MakeCaption(string text, int y) => new()
    {
        Text = text,
        Location = new Point(16, y),
        Size = new Size(428, 16),
    };

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

    private void SetBusy(bool busy)
    {
        UseWaitCursor = busy;
        _pairButton.Enabled = !busy;
        _closeButton.Enabled = !busy;
        _pairButton.Text = busy ? "Pairing…" : "Pair";
    }

    private void ShowError(string message)
    {
        _messageLabel.Text = message;
        _messageLabel.Visible = true;
    }

    private async Task PairAsync()
    {
        var serverInput = _serverBox.Text.Trim();
        var code = _codeBox.Text.Trim().ToUpperInvariant();
        var machineName = _machineBox.Text.Trim();

        if (serverInput.Length == 0 || serverInput.Equals("https://", StringComparison.Ordinal))
        {
            ShowError("Please enter the URL of your shop server (e.g. https://print.myshop.com).");
            _serverBox.Focus();
            return;
        }

        if (code.Length != 6)
        {
            ShowError("The pairing code has exactly 6 characters (letters and digits).");
            _codeBox.Focus();
            return;
        }

        if (machineName.Length == 0)
        {
            ShowError("Please enter a name for this computer.");
            _machineBox.Focus();
            return;
        }

        string serverUrl;
        try
        {
            serverUrl = ApiClient.NormalizeServerUrl(serverInput);
        }
        catch (ArgumentException ex)
        {
            ShowError(ex.Message);
            _serverBox.Focus();
            return;
        }

        SetBusy(true);
        _messageLabel.Visible = false;
        try
        {
            using var api = new ApiClient(serverUrl);
            var response = await api.PairAsync(code, machineName);

            _store.ServerUrl = serverUrl;
            _store.DeviceToken = response.DeviceToken;
            _store.DeviceId = response.Device.Id;
            _store.ShopName = response.Shop.Name;
            _store.ShopSlug = response.Shop.Slug;
            _store.MachineName = machineName;
            _store.AutoStartEnabled = _autoStartBox.Checked ? "true" : "false";
            AutoStart.SetEnabled(_autoStartBox.Checked);

            Logger.Info(
                $"Paired with '{response.Shop.Name}' as device '{response.Device.Name}' " +
                $"({response.Device.Id}, token {Logger.MaskSecret(response.DeviceToken)}).");
            Paired?.Invoke();
        }
        catch (ApiException ex)
        {
            Logger.Warn($"Pairing failed: {ex.Message} ({ex.StatusCode}).");
            ShowError(AuthoritativeCodeErrors.Contains(ex.StatusCode)
                ? $"{ex.Message} Generate a fresh code in the dashboard and try again."
                : ex.Message);
        }
        catch (HttpRequestException ex)
        {
            Logger.Warn($"Pairing failed (network): {ex.Message}");
            ShowError($"Could not reach {serverUrl} — check the URL and your internet connection.");
        }
        catch (TaskCanceledException)
        {
            Logger.Warn("Pairing timed out.");
            ShowError("The server did not answer in time — try again in a moment.");
        }
        catch (Exception ex)
        {
            Logger.Error("Pairing failed unexpectedly.", ex);
            ShowError($"Pairing failed: {ex.Message}");
        }
        finally
        {
            // When Paired fired, TrayContext closed this form — guard against a disposed control.
            if (!IsDisposed) SetBusy(false);
        }
    }
}
