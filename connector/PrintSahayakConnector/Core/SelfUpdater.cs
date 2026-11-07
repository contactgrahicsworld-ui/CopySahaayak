using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;

namespace PrintSahayakConnector.Core;

/// <summary>
/// The install half of the self-update: takes a downloaded, checksum-verified file
/// and puts the new version on disk, then restarts the connector.
///
/// Two supported builds:
///   • NSIS setup install (Program Files) — run <c>DesktopSahaayak-Setup.exe /S</c>;
///     the installer stops this process, replaces the files and (since 1.6.0)
///     starts the connector again automatically after a silent install.
///   • Portable single exe — swap the exe in place (renaming a running exe is
///     allowed on Windows) and restart through a short cmd helper that waits for
///     this process (and its single-instance mutex) to fully exit.
/// </summary>
public static class SelfUpdater
{
    /// <summary>Where update downloads are kept (cleared on startup, see <see cref="CleanStaleDownloads"/>).</summary>
    public static string UpdateDir => Path.Combine(Logger.AppDataRoot, "Update");

    /// <summary>
    /// True when the connector lives in an NSIS-managed install: an Uninstall.exe
    /// next to it or it sits under Program Files. When unsure this returns true so
    /// the update takes the setup path, which is the shipped default.
    /// </summary>
    public static bool IsInstalledBuild()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) return true;
            var dir = Path.GetDirectoryName(exe)!;
            if (File.Exists(Path.Combine(dir, "Uninstall.exe"))) return true;
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            return !string.IsNullOrEmpty(programFiles)
                && dir.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Could not decide the build flavour, assuming setup install: {ex.Message}");
            return true;
        }
    }

    /// <summary>
    /// Verifies <paramref name="filePath"/> against the server-provided SHA-256.
    /// An empty expectation (older server) skips verification instead of failing.
    /// Throws <see cref="InvalidDataException"/> on a mismatch — the caller must
    /// then discard the file and never run it.
    /// </summary>
    public static void VerifySha256(string filePath, string? expectedSha256)
    {
        if (string.IsNullOrWhiteSpace(expectedSha256)) return;

        using var sha = SHA256.Create();
        using var stream = File.OpenRead(filePath);
        var actual = Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
        var expected = expectedSha256.Trim().ToLowerInvariant();
        if (actual != expected)
        {
            throw new InvalidDataException($"Update checksum mismatch: {actual} != {expected}");
        }
    }

    /// <summary>
    /// Starts the NSIS installer silently (/S). The UAC prompt is raised here and
    /// answered synchronously: returns false when the shop declined it, true once
    /// the installer is running (it then stops this process, installs and restarts).
    /// </summary>
    public static bool RunSetupInstaller(string setupPath)
    {
        var psi = new ProcessStartInfo(setupPath, "/S")
        {
            UseShellExecute = true,
            Verb = "runas",
            WorkingDirectory = Path.GetDirectoryName(setupPath) ?? UpdateDir,
        };
        try
        {
            Process.Start(psi);
            return true;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            // ERROR_CANCELLED — the user said "No" to the UAC consent dialog.
            Logger.Info("Update installer cancelled at the UAC prompt.");
            return false;
        }
    }

    /// <summary>
    /// Portable self-replace: park the running exe as <c>*.old.exe</c>, move the
    /// downloaded build into the original name and schedule a restart a few seconds
    /// later, once this process (and its single-instance mutex) is really gone.
    /// </summary>
    public static void InstallPortable(string newExePath)
    {
        var exe = Environment.ProcessPath ?? throw new InvalidOperationException("No process path.");
        var oldPath = exe + ".old.exe";
        if (File.Exists(oldPath))
        {
            try { File.Delete(oldPath); }
            catch (Exception ex) { Logger.Warn($"Could not remove the previous .old.exe: {ex.Message}"); }
        }

        File.Move(exe, oldPath);
        File.Move(newExePath, exe);
        Logger.Info("Portable exe replaced; restarting in 3 seconds.");

        var helper = new ProcessStartInfo(
            "cmd.exe",
            "/c timeout /t 3 /nobreak >nul & start \"\" \"" + exe + "\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(exe) ?? UpdateDir,
        };
        Process.Start(helper);
    }

    /// <summary>Deletes finished/abandoned update downloads older than 7 days.</summary>
    public static void CleanStaleDownloads()
    {
        try
        {
            if (!Directory.Exists(UpdateDir)) return;
            foreach (var file in Directory.EnumerateFiles(UpdateDir))
            {
                if (File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddDays(-7))
                {
                    File.Delete(file);
                }
            }
        }
        catch (Exception ex)
        {
            Logger.Debug($"Update cache cleanup skipped: {ex.Message}");
        }
    }
}
