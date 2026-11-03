using System.Diagnostics;

namespace PhotocopyShopConnector.Core;

/// <summary>Severity levels for log entries.</summary>
public enum LogLevel
{
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

/// <summary>
/// Minimal rolling-file logger: one file per day (<c>log-yyyyMMdd.txt</c>) inside
/// <c>%APPDATA%\PhotocopyShopConnector\Logs</c>. Logging must never crash the app,
/// so every write is guarded and failures are swallowed.
/// </summary>
public static class Logger
{
    private const int RetentionDays = 30;

    private static readonly object Gate = new();
    private static string _logDir = string.Empty;

    /// <summary>Root folder for all application state (<c>%APPDATA%\PhotocopyShopConnector</c>).</summary>
    public static string AppDataRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PhotocopyShopConnector");

    /// <summary>Folder that contains the rolling log files.</summary>
    public static string LogDirectory => _logDir;

    /// <summary>Path of today's log file.</summary>
    public static string CurrentLogFile => Path.Combine(_logDir, $"log-{DateTime.Now:yyyyMMdd}.txt");

    /// <summary>Creates the log folder, prunes old files and writes a session header.</summary>
    public static void Init(string appVersion)
    {
        try
        {
            _logDir = Path.Combine(AppDataRoot, "Logs");
            Directory.CreateDirectory(_logDir);
            PruneOldLogs();
            Info($"---- {appVersion} session start ----");
        }
        catch
        {
            // Swallow — logging must never take the app down.
        }
    }

    /// <summary>Logs a debug message.</summary>
    public static void Debug(string message) => Write(LogLevel.Debug, message, null);

    /// <summary>Logs an informational message.</summary>
    public static void Info(string message) => Write(LogLevel.Info, message, null);

    /// <summary>Logs a warning.</summary>
    public static void Warn(string message) => Write(LogLevel.Warn, message, null);

    /// <summary>Logs an error, optionally with the full exception (stack trace included).</summary>
    public static void Error(string message, Exception? ex = null) => Write(LogLevel.Error, message, ex);

    /// <summary>
    /// Masks a secret (e.g. the device token) so only the first/last few characters
    /// are visible in logs.
    /// </summary>
    public static string MaskSecret(string? secret)
    {
        if (string.IsNullOrEmpty(secret)) return "(none)";
        return secret.Length <= 8 ? "***" : $"{secret[..6]}…{secret[^4..]}";
    }

    /// <summary>Opens the log folder in Windows Explorer.</summary>
    public static void OpenLogFolder()
    {
        try
        {
            Directory.CreateDirectory(_logDir);
            using var process = Process.Start(new ProcessStartInfo { FileName = _logDir, UseShellExecute = true });
            if (process != null) process.Dispose();
        }
        catch (Exception ex)
        {
            Write(LogLevel.Error, "Could not open log folder: " + ex.Message, ex);
        }
    }

    private static void Write(LogLevel level, string message, Exception? ex)
    {
        lock (Gate)
        {
            try
            {
                if (string.IsNullOrEmpty(_logDir)) return;
                var line =
                    $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{LevelName(level)}] [t{Environment.CurrentManagedThreadId:D2}] {message}";
                if (ex != null) line += Environment.NewLine + ex;
                File.AppendAllText(CurrentLogFile, line + Environment.NewLine);
            }
            catch
            {
                // Ignore all logging failures (disk full, permissions, ...).
            }
        }
    }

    private static string LevelName(LogLevel level) => level switch
    {
        LogLevel.Debug => "DBG",
        LogLevel.Info => "INF",
        LogLevel.Warn => "WRN",
        _ => "ERR",
    };

    private static void PruneOldLogs()
    {
        try
        {
            var cutoff = DateTime.Now.AddDays(-RetentionDays);
            foreach (var file in Directory.EnumerateFiles(_logDir, "log-*.txt"))
            {
                if (File.GetLastWriteTime(file) < cutoff) File.Delete(file);
            }
        }
        catch
        {
            // Best effort.
        }
    }
}
