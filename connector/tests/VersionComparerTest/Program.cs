// Minimal assertion harness for VersionComparer.IsNewer — the logic that decides
// whether the connector nags the shop about an update. Run:
//   ~/.dotnet/dotnet run --project connector/tests/VersionComparerTest
using PrintSahayakConnector.Core;

var failures = 0;

void Check(string? latest, string? current, bool expected, string label)
{
    var actual = VersionComparer.IsNewer(latest, current);
    if (actual == expected)
    {
        Console.WriteLine($"PASS  {label}: IsNewer({Show(latest)}, {Show(current)}) == {expected}");
    }
    else
    {
        failures++;
        Console.WriteLine($"FAIL  {label}: IsNewer({Show(latest)}, {Show(current)}) == {actual}, expected {expected}");
    }
}

static string Show(string? s) => s == null ? "null" : $"\"{s}\"";

// strictly newer / equal / older
Check("1.5.0", "1.4.0", true, "newer patch-of-major");
Check("1.4.0", "1.4.0", false, "same version");
Check("1.4.1", "1.4.0", true, "patch bump");
Check("1.3.9", "1.4.0", false, "older");
Check("1.4", "1.4.0", false, "two-part equal");
Check("2.0", "1.4.0", true, "major bump two-part");

// server answers with the same shapes the endpoint / GitHub can emit
Check("v1.5.0", "1.4.0", true, "v-prefixed newer");
Check("1.5.0-beta", "1.4.0", true, "prerelease suffix ignored");
Check("connector-v1.5.0", "1.4.0", true, "accidental full tag");

// unusable answers must never nag
Check(null, "1.4.0", false, "null latest");
Check("", "1.4.0", false, "empty latest");
Check("abc", "1.4.0", false, "garbage latest");
Check("1.4.0", null, false, "null current");
Check("1.4.0", "", false, "empty current");
Check("1.4.0", "abc", false, "garbage current");

Console.WriteLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
return failures == 0 ? 0 : 1;
