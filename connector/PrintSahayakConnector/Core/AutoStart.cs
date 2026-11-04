using Microsoft.Win32;

namespace PrintSahayakConnector.Core;

/// <summary>Manages the HKCU Run key that starts the connector with Windows.</summary>
public static class AutoStart
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "PrintSahayakConnector";

    /// <summary>Whether the autostart Run value currently exists.</summary>
    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(ValueName) is string;
        }
        catch (Exception ex)
        {
            Logger.Warn("Could not read autostart state: " + ex.Message);
            return false;
        }
    }

    /// <summary>Enables or disables starting the connector with Windows.</summary>
    public static void SetEnabled(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
            if (key is null) return;

            if (enabled)
            {
                var exePath = Environment.ProcessPath;
                if (string.IsNullOrEmpty(exePath))
                {
                    Logger.Warn("Could not determine the executable path; autostart not changed.");
                    return;
                }

                key.SetValue(ValueName, $"\"{exePath}\"");
                Logger.Info($"Autostart enabled ({exePath}).");
            }
            else if (key.GetValue(ValueName) is not null)
            {
                key.DeleteValue(ValueName);
                Logger.Info("Autostart disabled.");
            }
        }
        catch (Exception ex)
        {
            Logger.Error("Could not update the autostart registry key.", ex);
        }
    }
}
