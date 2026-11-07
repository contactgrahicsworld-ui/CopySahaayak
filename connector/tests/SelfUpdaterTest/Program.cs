// Tests for the install half of the self-update: checksum verification (the
// security-critical path) and the stale-download cleaner. Run:
//   XDG_CONFIG_HOME=/tmp/sut-home ~/.dotnet/dotnet run --project connector/tests/SelfUpdaterTest
using System.Security.Cryptography;
using PrintSahayakConnector.Core;

var failures = 0;

void Expect(bool condition, string label)
{
    if (condition) Console.WriteLine($"PASS  {label}");
    else { failures++; Console.WriteLine($"FAIL  {label}"); }
}

var workDir = Path.Combine(Path.GetTempPath(), "selfupdater-test", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(workDir);
var payload = "Desktop Sahaayak update payload \u0928\u092f\u093e \u0935\u0930\u094d\u091c\u0928";
var file = Path.Combine(workDir, "setup.exe");
File.WriteAllText(file, payload);

string Sha256Of(string path)
{
    using var sha = SHA256.Create();
    using var stream = File.OpenRead(path);
    return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
}

var correct = Sha256Of(file);

// 1. correct hash → accepted, no exception
var threw = false;
try { SelfUpdater.VerifySha256(file, correct); }
catch { threw = true; }
Expect(!threw, "VerifySha256 accepts the correct hash");

// 2. uppercase server answer → still accepted (case-insensitive)
threw = false;
try { SelfUpdater.VerifySha256(file, correct.ToUpperInvariant()); }
catch { threw = true; }
Expect(!threw, "VerifySha256 is case-insensitive");

// 3. tampered file → rejected
File.WriteAllText(file, payload + " 1 extra byte");
var wrong = Sha256Of(file);
var rejected = false;
try { SelfUpdater.VerifySha256(file, correct); }
catch (InvalidDataException) { rejected = true; }
Expect(rejected, "VerifySha256 rejects a modified file");

// 4. empty / null expectation → verification skipped, never throws
threw = false;
try { SelfUpdater.VerifySha256(file, null); SelfUpdater.VerifySha256(file, ""); SelfUpdater.VerifySha256(file, "  "); }
catch { threw = true; }
Expect(!threw, "VerifySha256 skips when the server sends no hash");

// 5. IsInstalledBuild answers without throwing (true = setup path on this box)
var flavour = false;
threw = false;
try { flavour = SelfUpdater.IsInstalledBuild(); }
catch { threw = true; }
Expect(!threw && flavour is true or false, "IsInstalledBuild returns a value without throwing");

// 6. CleanStaleDownloads removes files older than 7 days, keeps fresh ones
var updateDir = SelfUpdater.UpdateDir;
Directory.CreateDirectory(updateDir);
var stale = Path.Combine(updateDir, "DesktopSahaayak-Setup-0.0.1.exe");
var fresh = Path.Combine(updateDir, "DesktopSahaayak-Setup-9.9.9.exe");
File.WriteAllText(stale, "old");
File.WriteAllText(fresh, "new");
File.SetLastWriteTimeUtc(stale, DateTime.UtcNow.AddDays(-8));
SelfUpdater.CleanStaleDownloads();
Expect(!File.Exists(stale) && File.Exists(fresh), "CleanStaleDownloads prunes only stale files");

// 7. UpdateDir lives inside the app data root (never in TEMP next to the payload)
Expect(updateDir.StartsWith(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintSahayakConnector"), StringComparison.Ordinal),
    "UpdateDir is inside %APPDATA%/PrintSahayakConnector");

try { Directory.Delete(workDir, recursive: true); } catch { /* best effort */ }

Console.WriteLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
return failures == 0 ? 0 : 1;
