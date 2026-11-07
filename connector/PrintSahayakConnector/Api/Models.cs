namespace PrintSahayakConnector.Api;

/// <summary>Request body for <c>POST /api/device/pair</c>.</summary>
public sealed record PairRequest(string PairingCode, string MachineName, string AppVersion);

/// <summary>Successful pairing response.</summary>
public sealed record PairResponse(string DeviceToken, DeviceInfo Device, ShopInfo Shop);

/// <summary>Device identity as known by the server.</summary>
public sealed record DeviceInfo(string Id, string Name);

/// <summary>Shop identity as known by the server.</summary>
public sealed record ShopInfo(string Name, string Slug);

/// <summary>A printer registered for this device on the server.</summary>
public sealed record ServerPrinter(string Id, string WindowsName, string ColorMode, List<string>? PaperSizes);

/// <summary>Response of <c>GET /api/device/me</c>.</summary>
public sealed record MeResponse(DeviceInfo Device, ShopInfo Shop, List<ServerPrinter>? Printers);

/// <summary>One printer entry in the heartbeat payload.</summary>
public sealed record HeartbeatPrinter(string WindowsName, string ColorMode, List<string> PaperSizes);

/// <summary>Request body for <c>POST /api/device/heartbeat</c> (upserts the device's printers).</summary>
public sealed record HeartbeatRequest(List<HeartbeatPrinter> Printers, string AppVersion);

/// <summary>Response of <c>POST /api/device/heartbeat</c>.</summary>
public sealed record HeartbeatResponse(bool Ok, string DeviceStatus);

/// <summary>Document metadata of a claimed job.</summary>
public sealed record JobDocument(string Id, string FileName, string MimeType, string DownloadUrl);

/// <summary>Print settings of a claimed job.</summary>
public sealed record JobPrintSettings(
    int Copies,
    string ColorMode,
    string PaperSize,
    bool Duplex,
    int? PageFrom,
    int? PageTo);

/// <summary>Target printer chosen by the server for a job.</summary>
public sealed record JobPrinter(string Id, string WindowsName);

/// <summary>A print job claimed via <c>POST /api/device/jobs/claim</c>.</summary>
public sealed record ClaimedJob(
    string Id,
    string? SpoolDocumentName,
    string? OrderNumber,
    JobDocument Document,
    JobPrintSettings? PrintSettings,
    JobPrinter? Printer);

/// <summary>Response of <c>POST /api/device/jobs/claim</c> — <see cref="Job"/> is null when nothing is available.</summary>
public sealed record ClaimResponse(ClaimedJob? Job);

/// <summary>Request body for <c>POST /api/device/jobs/&lt;id&gt;/events</c>.</summary>
public sealed record JobEventRequest(string Status, string? Message);

/// <summary>Answer of the public <c>GET /api/downloads/connector/version</c> endpoint.
/// <see cref="Sha256"/>/<see cref="SizeBytes"/> are optional: an older server omits
/// them and the connector then skips the checksum verification instead of failing.</summary>
public sealed record UpdateInfo(
    string? Version,
    string? DownloadUrl,
    string? Notes,
    string? Sha256 = null,
    long? SizeBytes = null);
