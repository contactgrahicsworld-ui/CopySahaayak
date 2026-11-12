using System.Data;
using PhotocopyShopConnector.Core;

namespace PhotocopyShopConnector.UI;

/// <summary>
/// Lets the shop owner decide which of the locally installed Windows printers may
/// receive jobs, in which colour mode (BW / COLOR / ANY) and with which default
/// paper size (A4 / A3 / A5 / LEGAL / LETTER). Saving persists the mappings via
/// <see cref="LocalStore"/> and raises <see cref="Saved"/> — the tray context then
/// triggers an immediate heartbeat so the server learns the new mapping at once.
/// </summary>
public sealed class PrinterMappingForm : Form
{
    private const string ColEnabled = "Enabled";
    private const string ColPrinter = "Printer";
    private const string ColColor = "ColorMode";
    private const string ColPaper = "PaperSize";

    /// <summary>Empty value = the printer's own default paper size.</summary>
    private const string DefaultPaperValue = "";

    private static readonly (string Value, string Display)[] ColorChoices =
    {
        ("BW", "Black & white"),
        ("COLOR", "Colour"),
        ("ANY", "Any (job decides)"),
    };

    private static readonly (string Value, string Display)[] PaperChoices =
    {
        (DefaultPaperValue, "(printer default)"),
        ("A4", "A4"),
        ("A3", "A3"),
        ("A5", "A5"),
        ("LEGAL", "US Legal"),
        ("LETTER", "US Letter"),
    };

    private readonly LocalStore _store;
    private readonly DataGridView _grid = new();
    private readonly Button _saveButton = new();
    private readonly Button _refreshButton = new();
    private readonly Button _closeButton = new();
    private readonly Label _infoLabel = new();

    /// <summary>Raised after the mappings were saved (the tray context heartbeats immediately).</summary>
    public event Action? Saved;

    /// <summary>Creates the printer mapping window.</summary>
    public PrinterMappingForm(LocalStore store)
    {
        _store = store;

        Text = "Printer Settings";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(640, 470);
        Icon = TryLoadIcon();

        _infoLabel.Text = "Tick the printers that should receive jobs and pick how they print. " +
                          "Saved settings are pushed to the shop server immediately.";
        _infoLabel.Location = new Point(14, 12);
        _infoLabel.Size = new Size(612, 30);

        BuildGrid();

        _saveButton.Text = "Save";
        _saveButton.Size = new Size(88, 28);
        _saveButton.Location = new Point(440, 424);
        _saveButton.UseVisualStyleBackColor = true;
        _saveButton.Click += (_, _) => Save();

        _refreshButton.Text = "Rescan";
        _refreshButton.Size = new Size(88, 28);
        _refreshButton.Location = new Point(532, 424);
        _refreshButton.UseVisualStyleBackColor = true;
        _refreshButton.Click += (_, _) => ReloadGrid();

        _closeButton.Text = "Close";
        _closeButton.Size = new Size(88, 28);
        _closeButton.Location = new Point(348, 424);
        _closeButton.UseVisualStyleBackColor = true;
        _closeButton.Click += (_, _) => Close();

        CancelButton = _closeButton;

        Controls.AddRange(new Control[] { _infoLabel, _grid, _closeButton, _saveButton, _refreshButton });

        Load += (_, _) => ReloadGrid();
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

    private void BuildGrid()
    {
        _grid.Location = new Point(14, 48);
        _grid.Size = new Size(612, 364);
        _grid.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        _grid.AllowUserToAddRows = false;
        _grid.AllowUserToDeleteRows = false;
        _grid.AllowUserToResizeRows = false;
        _grid.RowHeadersVisible = false;
        _grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _grid.MultiSelect = false;
        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _grid.BackgroundColor = SystemColors.Window;

        var enabledColumn = new DataGridViewCheckBoxColumn
        {
            Name = ColEnabled,
            HeaderText = "Use",
            ToolTipText = "Send jobs to this printer",
            ValueType = typeof(bool),
            FillWeight = 8,
        };

        var printerColumn = new DataGridViewTextBoxColumn
        {
            Name = ColPrinter,
            HeaderText = "Windows printer",
            ReadOnly = true,
            FillWeight = 44,
        };

        var colorColumn = MakeChoiceColumn(ColColor, "Colour mode", ColorChoices, "Force greyscale (BW), colour (COLOR) or accept any job (ANY)");
        colorColumn.FillWeight = 24;

        var paperColumn = MakeChoiceColumn(ColPaper, "Default paper", PaperChoices, "Default paper size reported to the shop server");
        paperColumn.FillWeight = 24;

        _grid.Columns.AddRange(enabledColumn, printerColumn, colorColumn, paperColumn);
    }

    private static DataGridViewComboBoxColumn MakeChoiceColumn(
        string name, string header, (string Value, string Display)[] choices, string toolTip)
    {
        var table = new DataTable();
        table.Columns.Add("Value", typeof(string));
        table.Columns.Add("Display", typeof(string));
        foreach (var (value, display) in choices)
        {
            table.Rows.Add(value, display);
        }

        return new DataGridViewComboBoxColumn
        {
            Name = name,
            HeaderText = header,
            ToolTipText = toolTip,
            DataSource = table,
            DisplayMember = "Display",
            ValueMember = "Value",
            ValueType = typeof(string),
            FlatStyle = FlatStyle.Flat,
        };
    }

    /// <summary>Rebuilds the grid from the installed printers plus the saved mappings.</summary>
    private void ReloadGrid()
    {
        // Keep what the user edited in the current session even across a rescan.
        var edits = CaptureGridState();
        var mappings = _store.GetPrinters()
            .GroupBy(mapping => mapping.WindowsName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        _grid.Rows.Clear();

        foreach (var name in EnumerateInstalledPrinters())
        {
            var index = _grid.Rows.Add();
            var row = _grid.Rows[index];

            if (edits.TryGetValue(name, out var edit))
            {
                row.Cells[ColEnabled].Value = edit.Enabled;
                row.Cells[ColColor].Value = edit.ColorMode;
                row.Cells[ColPaper].Value = edit.PaperSize;
            }
            else if (mappings.TryGetValue(name, out var mapping))
            {
                row.Cells[ColEnabled].Value = true;
                row.Cells[ColColor].Value = NormalizeColor(mapping.ColorMode);
                row.Cells[ColPaper].Value = mapping.DefaultPaperSize ?? DefaultPaperValue;
            }
            else
            {
                row.Cells[ColEnabled].Value = false;
                row.Cells[ColColor].Value = "BW";
                row.Cells[ColPaper].Value = DefaultPaperValue;
            }

            row.Cells[ColPrinter].Value = name;
        }

        var count = _grid.Rows.Count;
        _infoLabel.Text = count == 0
            ? "No printers are installed on this computer. Install a printer in Windows first, then click Rescan."
            : $"{count} printer(s) found — tick the ones that should receive jobs. " +
              "BW forces greyscale, COLOR is for colour jobs, ANY accepts everything.";
        _saveButton.Enabled = count > 0;
    }

    private static IEnumerable<string> EnumerateInstalledPrinters()
    {
        // System.Drawing.Printing.PrinterSettings.InstalledPrinters
        var names = new List<string>();
        foreach (string name in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
        {
            names.Add(name);
        }

        return names.OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }

    private Dictionary<string, (bool Enabled, string ColorMode, string PaperSize)> CaptureGridState()
    {
        var state = new Dictionary<string, (bool, string, string)>(StringComparer.OrdinalIgnoreCase);
        foreach (DataGridViewRow row in _grid.Rows)
        {
            if (row.Cells[ColPrinter].Value is not string name || name.Length == 0) continue;
            state[name] = (
                row.Cells[ColEnabled].Value is true,
                NormalizeColor(row.Cells[ColColor].Value as string),
                row.Cells[ColPaper].Value as string ?? DefaultPaperValue);
        }

        return state;
    }

    private static string NormalizeColor(string? colorMode) =>
        ColorChoices.Any(choice => choice.Value.Equals(colorMode, StringComparison.OrdinalIgnoreCase))
            ? colorMode!.ToUpperInvariant()
            : "BW";

    /// <summary>Persists the enabled printers and raises <see cref="Saved"/>.</summary>
    private void Save()
    {
        var mappings = new List<PrinterMapping>();
        foreach (DataGridViewRow row in _grid.Rows)
        {
            if (row.Cells[ColPrinter].Value is not string name || name.Length == 0) continue;
            if (row.Cells[ColEnabled].Value is not true) continue;

            mappings.Add(new PrinterMapping(
                name,
                NormalizeColor(row.Cells[ColColor].Value as string),
                row.Cells[ColPaper].Value as string ?? DefaultPaperValue));
        }

        if (mappings.Count == 0)
        {
            var answer = MessageBox.Show(
                "No printer is enabled. The shop server will not be able to send jobs to this computer.\r\n\r\n" +
                "Save anyway?",
                Text,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return;
        }

        try
        {
            _store.SavePrinters(mappings);
            Logger.Info($"Printer mapping saved ({mappings.Count} printer(s): {string.Join(", ", mappings.Select(m => m.WindowsName))}).");
        }
        catch (Exception ex)
        {
            Logger.Error("Could not save the printer mapping.", ex);
            MessageBox.Show(
                $"The printer mapping could not be saved:\r\n{ex.Message}",
                Text,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        Saved?.Invoke();
        Close();
    }
}
