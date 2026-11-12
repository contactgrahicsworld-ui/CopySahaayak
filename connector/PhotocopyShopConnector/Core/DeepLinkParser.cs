namespace PhotocopyShopConnector.Core;

/// <summary>A parsed <c>photocopyconnector://pair</c> deep link.</summary>
public sealed record PairingLink(string ServerUrl, string PairingCode);

/// <summary>
/// Parses <c>photocopyconnector://pair?server=&lt;urlencoded&gt;&amp;code=&lt;6 chars&gt;</c>
/// deep links. The installer registers the protocol handler; the Shop Admin dashboard
/// can hand out such links for one-click pairing.
/// </summary>
public static class DeepLinkParser
{
    /// <summary>URL protocol scheme registered by the NSIS installer.</summary>
    public const string Scheme = "photocopyconnector";

    /// <summary>Returns the first argument that looks like one of our deep links, or null.</summary>
    public static string? FindLink(string[] args) =>
        args.FirstOrDefault(a => !string.IsNullOrEmpty(a) &&
                                 a.StartsWith(Scheme + "://", StringComparison.OrdinalIgnoreCase));

    /// <summary>Parses a deep link into server URL + pairing code; null when malformed.</summary>
    public static PairingLink? Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            var uri = new Uri(raw);
            if (!uri.Host.Equals("pair", StringComparison.OrdinalIgnoreCase)) return null;

            var query = ParseQuery(uri.Query);
            var server = query.TryGetValue("server", out var s) ? s : null;
            var code = query.TryGetValue("code", out var c) ? c : null;
            if (string.IsNullOrWhiteSpace(server) || string.IsNullOrWhiteSpace(code)) return null;

            return new PairingLink(server, code.Trim().ToUpperInvariant());
        }
        catch (UriFormatException)
        {
            return null;
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            var key = eq < 0 ? part : part[..eq];
            var value = eq < 0 ? string.Empty : Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
            result[key.Trim()] = value;
        }

        return result;
    }
}
