using System.Text.RegularExpressions;

namespace PrintSahayakConnector.Core;

/// <summary>
/// Compares dotted version strings ("1.4.0", "v1.5", "1.5.0-beta") so the update
/// checker can decide whether the server offers a newer build. Parsing is forgiving:
/// anything unparseable yields "not newer" — a bad server answer must never nag.
/// </summary>
public static class VersionComparer
{
    /// <summary>Returns true when <paramref name="latest"/> is strictly newer than <paramref name="current"/>.</summary>
    public static bool IsNewer(string? latest, string? current)
    {
        if (TryParse(latest, out var l) && TryParse(current, out var c))
        {
            return l.CompareTo(c) > 0;
        }

        return false;
    }

    private static bool TryParse(string? text, out Version version)
    {
        version = new Version(0, 0, 0);
        if (string.IsNullOrWhiteSpace(text)) return false;

        var trimmed = text.Trim().TrimStart('v', 'V');
        if (trimmed.StartsWith("connector-", StringComparison.OrdinalIgnoreCase))
        {
            // Defensive: tolerate a full GitHub tag like "connector-v1.5.0".
            trimmed = trimmed["connector-".Length..].TrimStart('v', 'V');
        }

        // Keep only the leading numeric dotted part ("1.5.0-beta" → "1.5.0").
        var match = Regex.Match(trimmed, @"^\d+(\.\d+){0,3}");
        if (!match.Success) return false;

        var parsed = Version.TryParse(match.Value, out var parsedVersion);
        version = parsedVersion ?? new Version(0, 0, 0);
        return parsed;
    }
}
