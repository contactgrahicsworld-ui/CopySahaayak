using System.Reflection;
using PrintSahayakConnector.Core;
using PrintSahayakConnector.UI;

namespace PrintSahayakConnector;

/// <summary>
/// Application entry point. Enforces single instance, initialises the logger and
/// hands control to the tray application context.
/// </summary>
internal static class Program
{
    /// <summary>Human readable product name used across dialogs, balloons and logs.</summary>
    public const string AppTitle = "Desktop Sahaayak";

    /// <summary>Application version as reported to the SaaS (major.minor.patch).</summary>
    public static string AppVersion { get; } =
        Assembly.GetEntryAssembly()?.GetName().Version is { } v
            ? $"{v.Major}.{v.Minor}.{v.Build}"
            : "1.0.0";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using var guard = new SingleInstanceGuard();
        if (!guard.IsFirstInstance)
        {
            var rawLink = DeepLinkParser.FindLink(args);
            if (!string.IsNullOrEmpty(rawLink))
            {
                // Forward the pairing deep link to the running instance and exit quietly.
                PairingHint.Publish(rawLink);
                return 0;
            }

            MessageBox.Show(
                $"{AppTitle} is already running. Look for the printer icon in the system tray.",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return 0;
        }

        Logger.Init(AppVersion);
        Logger.Info($"{AppTitle} {AppVersion} starting (pid {Environment.ProcessId}).");

        // TrayContext parses the raw deep link itself (prefills the pairing dialog).
        var deepLink = DeepLinkParser.FindLink(args);
        try
        {
            Application.Run(new TrayContext(deepLink));
        }
        catch (Exception ex)
        {
            Logger.Error("Unhandled exception in main loop.", ex);
            MessageBox.Show(
                $"An unexpected error occurred and the connector has to close.\n\n{ex.Message}",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        Logger.Info($"{AppTitle} exited cleanly.");
        return 0;
    }
}
