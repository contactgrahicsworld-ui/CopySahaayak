using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using PrintSahayakConnector.Core;

namespace PrintSahayakConnector.Api;

/// <summary>Thrown when the SaaS answers with a non-success status code.</summary>
public sealed class ApiException : Exception
{
    /// <summary>The HTTP status code returned by the server.</summary>
    public HttpStatusCode StatusCode { get; }

    public ApiException(HttpStatusCode statusCode, string? serverMessage)
        : base(string.IsNullOrWhiteSpace(serverMessage)
            ? $"The server responded with {(int)statusCode} {statusCode}."
            : serverMessage)
    {
        StatusCode = statusCode;
    }
}

/// <summary>
/// Thin typed HTTP client for the device API of the PrintSahayak SaaS.
/// Enforces HTTPS (plain http is only accepted for localhost development) and
/// attaches the device token to authenticated endpoints.
/// </summary>
public sealed class ApiClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private string? _deviceToken;

    /// <summary>Creates a client for the given (user provided) server URL.</summary>
    public ApiClient(string serverUrl)
    {
        ServerUrl = NormalizeServerUrl(serverUrl);
        _http = new HttpClient { BaseAddress = new Uri(ServerUrl + "/"), Timeout = TimeSpan.FromMinutes(2) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"PrintSahayakConnector/{Program.AppVersion}");
        ApplyAuthHeader();
    }

    /// <summary>Normalized base URL of the SaaS (no trailing slash).</summary>
    public string ServerUrl { get; }

    /// <summary>
    /// Normalizes and validates the user-provided server URL. Only https:// is
    /// accepted, except plain http:// to loopback hosts which is allowed for
    /// local development. Invalid TLS certificates abort the connection
    /// (default <see cref="HttpClient"/> behaviour).
    /// </summary>
    public static string NormalizeServerUrl(string input)
    {
        var trimmed = (input ?? string.Empty).Trim().TrimEnd('/');
        if (trimmed.Length == 0) throw new ArgumentException("Please enter the shop server URL.");

        if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = "https://" + trimmed;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
            string.IsNullOrEmpty(uri.Host) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            throw new ArgumentException("That does not look like a valid server URL.");
        }

        var isLocalHttp = uri.Scheme == Uri.UriSchemeHttp &&
                          (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                           uri.Host == "127.0.0.1" ||
                           uri.Host == "::1" ||
                           uri.Host == "[::1]");
        if (!isLocalHttp && uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new ArgumentException(
                "Only HTTPS servers are allowed (http://localhost is accepted for development).");
        }

        // A path beyond the root almost always means a customer-facing page URL was
        // pasted (e.g. https://host/s/shop-name) — jobs would then hit the wrong
        // endpoints. Reject it with an actionable message instead of failing later.
        var path = uri.AbsolutePath.TrimEnd('/');
        if (!string.IsNullOrEmpty(path))
        {
            throw new ArgumentException(
                "That looks like a page URL (it has " + path + " after the address). " +
                "In Shop server URL enter ONLY the site address — e.g. https://copysahaayak.vercel.app");
        }

        return uri.ToString().TrimEnd('/');
    }

    /// <summary>Sets (or clears) the device token used for authenticated endpoints.</summary>
    public void SetDeviceToken(string? token)
    {
        _deviceToken = token;
        ApplyAuthHeader();
    }

    private void ApplyAuthHeader()
    {
        _http.DefaultRequestHeaders.Authorization = string.IsNullOrEmpty(_deviceToken)
            ? null
            : new AuthenticationHeaderValue("Bearer", _deviceToken);
    }

    /// <summary>POST /api/device/pair — exchanges a pairing code for a device token.</summary>
    public async Task<PairResponse> PairAsync(string pairingCode, string machineName, CancellationToken ct = default)
    {
        var previous = _deviceToken;
        SetDeviceToken(null); // pairing is unauthenticated
        try
        {
            return await PostAsync<PairResponse, PairRequest>(
                "api/device/pair",
                new PairRequest(pairingCode, machineName, Program.AppVersion), ct);
        }
        finally
        {
            SetDeviceToken(previous);
        }
    }

    /// <summary>
    /// GET /api/downloads/connector/version — public endpoint (no device token needed)
    /// telling this app whether a newer build exists. Returns null on any failure or
    /// unusable answer; an update check must never surface an error to the shop.
    /// </summary>
    public async Task<UpdateInfo?> GetLatestVersionAsync(CancellationToken ct = default)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "api/downloads/connector/version");
            using var response = await _http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return null;
            var body = await response.Content.ReadAsStringAsync(ct);
            var info = JsonSerializer.Deserialize<UpdateInfo>(body, JsonOptions);
            // A relative downloadUrl is resolved against this connector's own server
            // so self-hosted deployments keep working unchanged.
            if (info?.DownloadUrl is { } url && url.StartsWith('/'))
            {
                info = info with { DownloadUrl = ServerUrl + url };
            }

            return info;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            Logger.Debug($"Update check skipped: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Dedicated client for the self-update download: 30 minutes instead of the
    /// 2-minute API timeout, because a 50 MB installer on a slow shop broadband
    /// line can legitimately take longer than two minutes. Static so the handler
    /// is reused and never dropped mid-download.
    /// </summary>
    private static readonly HttpClient DownloadClient = new()
    {
        Timeout = TimeSpan.FromMinutes(30),
    };

    /// <summary>
    /// Streams the update file at <paramref name="url"/> (absolute, or relative to
    /// this client's server URL) to <paramref name="destPath"/>, reporting progress
    /// in the 0..1 range. Throws on any HTTP or network error; the caller decides
    /// what the shop sees.
    /// </summary>
    public async Task<long> DownloadToFileAsync(
        string url, string destPath, IProgress<double>? progress, CancellationToken ct)
    {
        string absolute;
        if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            absolute = url;
        }
        else
        {
            // Resolve relative URLs against this connector's own server, exactly
            // like GetLatestVersionAsync does for the downloadUrl field.
            absolute = new Uri(new Uri(ServerUrl + "/"), url.TrimStart('/')).ToString();
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, absolute);
        using var response = await DownloadClient.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
            throw new ApiException(response.StatusCode, null);

        var total = response.Content.Headers.ContentLength ?? -1;
        var directory = Path.GetDirectoryName(destPath);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

        await using var httpStream = await response.Content.ReadAsStreamAsync(ct);
        await using var file = new FileStream(
            destPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        var buffer = new byte[81920];
        long written = 0;
        int read;
        while ((read = await httpStream.ReadAsync(buffer, ct)) > 0)
        {
            await file.WriteAsync(buffer.AsMemory(0, read), ct);
            written += read;
            if (progress != null && total > 0) progress.Report((double)written / total);
        }

        return total > 0 ? total : written;
    }

    /// <summary>GET /api/device/me — pairing state, shop and server-side printer list.</summary>
    public Task<MeResponse> GetMeAsync(CancellationToken ct = default) =>
        GetAsync<MeResponse>("api/device/me", ct);

    /// <summary>POST /api/device/heartbeat — upserts this device's printer list.</summary>
    public Task<HeartbeatResponse> HeartbeatAsync(HeartbeatRequest request, CancellationToken ct = default) =>
        PostAsync<HeartbeatResponse, HeartbeatRequest>("api/device/heartbeat", request, ct);

    /// <summary>POST /api/device/jobs/claim — claims the next available job (or null).</summary>
    public Task<ClaimResponse> ClaimJobAsync(CancellationToken ct = default) =>
        PostAsync<ClaimResponse, object>("api/device/jobs/claim", new { }, ct);

    /// <summary>POST /api/device/jobs/&lt;jobId&gt;/events — reports SPOOLING / COMPLETED / FAILED.</summary>
    public Task PostJobEventAsync(string jobId, string status, string? message, CancellationToken ct = default) =>
        SendNoResponseAsync(new HttpRequestMessage(HttpMethod.Post,
            $"api/device/jobs/{Uri.EscapeDataString(jobId)}/events")
        {
            Content = CreateJsonContent(new JobEventRequest(status, message)),
        }, ct);

    /// <summary>
    /// Downloads the job document to a temp file and returns its full path.
    /// The relative <c>downloadUrl</c> from the claim response is appended to the
    /// server base URL and fetched with the device token.
    /// </summary>
    public async Task<string> DownloadDocumentAsync(ClaimedJob job, CancellationToken ct = default)
    {
        var relative = job.Document.DownloadUrl;
        if (string.IsNullOrEmpty(relative) || !relative.StartsWith('/'))
            throw new InvalidOperationException("The server did not provide a valid document download URL.");

        const long sizeLimit = 512L * 1024 * 1024;
        using var response = await _http.GetAsync(relative, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > sizeLimit)
        {
            throw new InvalidOperationException(
                $"Document is too large ({response.Content.Headers.ContentLength.Value / 1024 / 1024} MB).");
        }

        var directory = Path.Combine(Path.GetTempPath(), "PrintSahayakConnector");
        Directory.CreateDirectory(directory);
        var safeJob = SanitizeFileName(string.IsNullOrEmpty(job.Id) ? "job" : job.Id);
        var safeName = SanitizeFileName(string.IsNullOrEmpty(job.Document.FileName) ? "document" : job.Document.FileName);
        var target = Path.Combine(directory, $"{safeJob}__{safeName}");

        await using (var source = await response.Content.ReadAsStreamAsync(ct))
        await using (var destination = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await source.ReadAsync(buffer, ct)) > 0)
            {
                total += read;
                if (total > sizeLimit)
                    throw new InvalidOperationException("Document exceeds the 512 MB size limit.");
                await destination.WriteAsync(buffer.AsMemory(0, read), ct);
            }
        }

        Logger.Debug($"Downloaded {job.Document.FileName} -> {target} ({new FileInfo(target).Length} bytes).");
        return target;
    }

    private async Task<TResponse> GetAsync<TResponse>(string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        return await SendAsync<TResponse>(request, ct);
    }

    private async Task<TResponse> PostAsync<TResponse, TBody>(string path, TBody body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = CreateJsonContent(body) };
        return await SendAsync<TResponse>(request, ct);
    }

    private static StringContent CreateJsonContent<TBody>(TBody body) =>
        new(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");

    private async Task<TResponse> SendAsync<TResponse>(HttpRequestMessage request, CancellationToken ct)
    {
        using var response = await _http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new ApiException(response.StatusCode, FriendlyErrorMessage(response.StatusCode, ExtractServerMessage(body)));
        try
        {
            return JsonSerializer.Deserialize<TResponse>(body, JsonOptions)
                   ?? throw new InvalidOperationException("Unexpected empty response from the server.");
        }
        catch (JsonException)
        {
            // A 2xx response that is not JSON is almost always a wrong URL serving
            // an HTML page — give the shop a clear pointer instead of a parse error.
            throw new InvalidOperationException(
                "The server answered but not with the expected service response. " +
                "Check the Shop server URL — use ONLY the site address, e.g. https://copysahaayak.vercel.app");
        }
    }

    private async Task SendNoResponseAsync(HttpRequestMessage request, CancellationToken ct)
    {
        using var response = await _http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new ApiException(response.StatusCode, FriendlyErrorMessage(response.StatusCode, ExtractServerMessage(body)));
    }

    /// <summary>
    /// Server-sent JSON message when present; otherwise a clear, actionable
    /// message for the status code. Raw HTML error pages are never surfaced.
    /// </summary>
    private static string FriendlyErrorMessage(HttpStatusCode status, string? serverMessage)
    {
        if (!string.IsNullOrWhiteSpace(serverMessage)) return serverMessage;
        return status switch
        {
            HttpStatusCode.NotFound =>
                "The server has no such service (404). Check the Shop server URL — enter ONLY the site address " +
                "(e.g. https://copysahaayak.vercel.app), not a page URL like …/s/shop-name.",
            HttpStatusCode.Unauthorized => "The pairing code is invalid or expired (401). Generate a fresh code in the dashboard.",
            HttpStatusCode.Forbidden => "Access denied (403) — the shop may be suspended or the code belongs to another shop.",
            HttpStatusCode.Gone => "This pairing code is no longer valid (410). Generate a fresh code in the dashboard.",
            HttpStatusCode.BadRequest => "The request was rejected (400) — check the pairing code (6 characters).",
            HttpStatusCode.TooManyRequests => "Too many attempts — wait a minute and try again.",
            HttpStatusCode.RequestTimeout => "The server took too long to answer (408) — try again in a moment.",
            HttpStatusCode.InternalServerError => "Server error (500) — try again in a moment; if it repeats, contact support.",
            HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout =>
                "The server is temporarily unavailable (" + (int)status + ") — try again in a couple of minutes.",
            _ => $"The server rejected the request ({(int)status}).",
        };
    }

    private static string? ExtractServerMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;

        // HTML error pages (wrong URL, proxy errors, …) are never shown raw — the
        // caller substitutes a friendly, status-specific message instead.
        var trimmed = body.TrimStart();
        if (trimmed.StartsWith('<')) return null;

        try
        {
            using var doc = JsonDocument.Parse(body);
            foreach (var key in new[] { "message", "error", "detail", "title" })
            {
                if (doc.RootElement.TryGetProperty(key, out var element) &&
                    element.ValueKind == JsonValueKind.String)
                {
                    var text = element.GetString();
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }
            }
        }
        catch (JsonException)
        {
            // Not JSON — fall through to a truncated plain-text body.
        }

        // Strip anything that looks like markup before showing a plain body.
        var plain = trimmed.StartsWith('{') || trimmed.StartsWith('[')
            ? body
            : System.Text.RegularExpressions.Regex.Replace(body, "<[^>]+>", " ").Trim();
        return plain.Length > 200 ? plain[..200] + "…" : plain;
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(name.Length);
        foreach (var ch in name)
        {
            sb.Append(Array.IndexOf(invalid, ch) >= 0 ? '_' : ch);
        }

        return sb.Length == 0 ? "file" : sb.ToString();
    }

    /// <inheritdoc />
    public void Dispose() => _http.Dispose();
}
