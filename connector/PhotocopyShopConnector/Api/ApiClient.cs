using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using PhotocopyShopConnector.Core;

namespace PhotocopyShopConnector.Api;

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
/// Thin typed HTTP client for the device API of the Photocopy Shop SaaS.
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
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"PhotocopyShopConnector/{Program.AppVersion}");
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

        var directory = Path.Combine(Path.GetTempPath(), "PhotocopyShopConnector");
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
            throw new ApiException(response.StatusCode, ExtractServerMessage(body));
        try
        {
            return JsonSerializer.Deserialize<TResponse>(body, JsonOptions)
                   ?? throw new InvalidOperationException("Unexpected empty response from the server.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Unexpected response from the server: {ex.Message}", ex);
        }
    }

    private async Task SendNoResponseAsync(HttpRequestMessage request, CancellationToken ct)
    {
        using var response = await _http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new ApiException(response.StatusCode, ExtractServerMessage(body));
    }

    private static string? ExtractServerMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            foreach (var key in new[] { "message", "error", "detail", "title" })
            {
                if (doc.RootElement.TryGetProperty(key, out var element) &&
                    element.ValueKind == JsonValueKind.String)
                {
                    return element.GetString();
                }
            }
        }
        catch (JsonException)
        {
            // Not JSON — fall through to raw body.
        }

        return body.Length > 300 ? body[..300] + "…" : body;
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
