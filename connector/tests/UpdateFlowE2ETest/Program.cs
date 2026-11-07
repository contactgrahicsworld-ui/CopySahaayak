// End-to-end test of the self-update DOWNLOAD path against a real HTTP server:
//   1. GET /api/downloads/connector/version  → UpdateInfo parsed (version, url,
//      sha256, sizeBytes) exactly like the connector does
//   2. VersionComparer decides 9.9.9 > current → update available
//   3. ApiClient.DownloadToFileAsync streams the installer with progress events
//   4. SelfUpdater.VerifySha256 validates the downloaded bytes
// Run (server must be up, see scripts/test-update-flow.sh):
//   ~/.dotnet/dotnet run --project connector/tests/UpdateFlowE2ETest -- <baseUrl>
using PrintSahayakConnector.Api;
using PrintSahayakConnector.Core;

var failures = 0;
void Expect(bool condition, string label)
{
    if (condition) Console.WriteLine($"PASS  {label}");
    else { failures++; Console.WriteLine($"FAIL  {label}"); }
}

var rejected = false;
var baseUrl = args.Length > 0 ? args[0] : "http://localhost:8765";
var expectedVersion = args.Length > 1 ? args[1] : "9.9.9";
var api = new ApiClient(baseUrl);

// 1. version manifest
var info = await api.GetLatestVersionAsync();
Expect(info != null, "version manifest parsed");
Expect(info?.Version == expectedVersion, $"manifest version == {expectedVersion} (got {info?.Version})");
Expect(!string.IsNullOrWhiteSpace(info?.DownloadUrl), "manifest has downloadUrl");
Expect(info?.Sha256?.Length == 64, "manifest has a 64-char sha256");
Expect(info?.SizeBytes > 0, "manifest has sizeBytes");
Expect(info?.DownloadUrl?.StartsWith(baseUrl) == true, "relative downloadUrl resolved against server");

// 2. comparison — the manifest version must beat 1.5.0 (the oldest self-updating build)
Expect(VersionComparer.IsNewer(info!.Version, "1.5.0"), $"{info.Version} is newer than the running 1.5.0");

// 3. download with progress
var updateDir = SelfUpdater.UpdateDir;
Directory.CreateDirectory(updateDir);
var dest = Path.Combine(updateDir, $"DesktopSahaayak-Setup-{info.Version}.exe");
if (File.Exists(dest)) File.Delete(dest);

var lastProgress = 0.0;
var progressReports = 0;
var progress = new Progress<double>(p => { lastProgress = p; Interlocked.Increment(ref progressReports); });
var written = await api.DownloadToFileAsync(info.DownloadUrl!, dest, progress, CancellationToken.None);
Expect(File.Exists(dest), "file downloaded");
Expect(new FileInfo(dest).Length == written && written == (info.SizeBytes ?? written),
    $"byte count matches manifest ({written} == {info.SizeBytes})");
Expect(progressReports > 0 && lastProgress > 0.99,
    $"progress reported ({progressReports} events, last {lastProgress:0.00})");

// 4. checksum verification of the real downloaded bytes
var threw = false;
try { SelfUpdater.VerifySha256(dest, info.Sha256); }
catch { threw = true; }
Expect(!threw, "VerifySha256 accepts the downloaded file");

// 5. tampered byte → rejected
var bytes = File.ReadAllBytes(dest);
bytes[^1] ^= 0xFF;
await File.WriteAllBytesAsync(dest + ".tampered", bytes);
rejected = false;
try { SelfUpdater.VerifySha256(dest + ".tampered", info.Sha256); }
catch (InvalidDataException) { rejected = true; }
Expect(rejected, "VerifySha256 rejects one flipped byte");
File.Delete(dest + ".tampered");

// 6. unreachable server must answer null, never throw (update checks are silent)
var dead = new ApiClient("https://localhost:1");
var deadInfo = await dead.GetLatestVersionAsync();
Expect(deadInfo == null, "unreachable server → null manifest, no throw");

Console.WriteLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
return failures == 0 ? 0 : 1;
