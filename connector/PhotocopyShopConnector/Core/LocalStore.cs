using Microsoft.Data.Sqlite;

namespace PhotocopyShopConnector.Core;

/// <summary>A single printer mapping configured by the shop owner.</summary>
/// <param name="WindowsName">Exact Windows printer name (as in <c>PrinterSettings.InstalledPrinters</c>).</param>
/// <param name="ColorMode">One of <c>BW</c>, <c>COLOR</c> or <c>ANY</c>.</param>
/// <param name="DefaultPaperSize">Canonical paper size (A4, A3, A5, LETTER, LEGAL) or empty.</param>
public sealed record PrinterMapping(string WindowsName, string ColorMode, string DefaultPaperSize);

/// <summary>
/// SQLite-backed local state: pairing information, printer mappings and the set of
/// completed job ids used for duplicate prevention (a job id that was already printed
/// is never printed again, even if the server re-queues it).
/// All access is serialized — the worker loop and the UI both use this store.
/// </summary>
public sealed class LocalStore
{
    private static readonly string[] SchemaStatements =
    {
        """
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS printers (
            windows_name       TEXT PRIMARY KEY,
            color_mode         TEXT NOT NULL,
            default_paper_size TEXT NOT NULL DEFAULT ''
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS completed_jobs (
            job_id       TEXT PRIMARY KEY,
            order_number TEXT NOT NULL DEFAULT '',
            completed_at TEXT NOT NULL,
            note         TEXT NOT NULL DEFAULT ''
        )
        """,
    };

    private const int CompletedJobsRetentionDays = 30;

    private readonly string _connectionString;
    private readonly object _gate = new();

    /// <summary>Opens (or creates) the state database at the given path.</summary>
    public LocalStore(string dbPath)
    {
        var directory = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        Initialize();
    }

    /// <summary>Reads a setting value, or null when it was never stored.</summary>
    public string? GetSetting(string key)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT value FROM settings WHERE key = $key";
            cmd.Parameters.AddWithValue("$key", key);
            return cmd.ExecuteScalar() as string;
        }
    }

    /// <summary>Writes a setting value; null deletes it.</summary>
    public void SetSetting(string key, string? value)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = value is null
                ? "DELETE FROM settings WHERE key = $key"
                : """
                  INSERT INTO settings(key, value) VALUES($key, $value)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value
                  """;
            cmd.Parameters.AddWithValue("$key", key);
            if (value != null) cmd.Parameters.AddWithValue("$value", value);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Base URL of the paired SaaS.</summary>
    public string? ServerUrl { get => GetSetting("serverUrl"); set => SetSetting("serverUrl", value); }

    /// <summary>Opaque device token issued during pairing (never leaves this machine except in the auth header).</summary>
    public string? DeviceToken { get => GetSetting("deviceToken"); set => SetSetting("deviceToken", value); }

    /// <summary>Device id assigned by the server.</summary>
    public string? DeviceId { get => GetSetting("deviceId"); set => SetSetting("deviceId", value); }

    /// <summary>Display name of the paired shop.</summary>
    public string? ShopName { get => GetSetting("shopName"); set => SetSetting("shopName", value); }

    /// <summary>Slug of the paired shop.</summary>
    public string? ShopSlug { get => GetSetting("shopSlug"); set => SetSetting("shopSlug", value); }

    /// <summary>Friendly name of this computer shown in the admin dashboard.</summary>
    public string? MachineName { get => GetSetting("machineName"); set => SetSetting("machineName", value); }

    /// <summary>"true"/"false" — whether the user wants the connector to start with Windows.</summary>
    public string? AutoStartEnabled { get => GetSetting("autoStart"); set => SetSetting("autoStart", value); }

    /// <summary>True when a server URL and device token are present.</summary>
    public bool IsPaired => !string.IsNullOrEmpty(ServerUrl) && !string.IsNullOrEmpty(DeviceToken);

    /// <summary>Returns all saved printer mappings, ordered by Windows printer name.</summary>
    public IReadOnlyList<PrinterMapping> GetPrinters()
    {
        lock (_gate)
        {
            var list = new List<PrinterMapping>();
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT windows_name, color_mode, default_paper_size FROM printers ORDER BY windows_name";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new PrinterMapping(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
            }

            return list;
        }
    }

    /// <summary>Replaces the complete set of printer mappings in one transaction.</summary>
    public void SavePrinters(IEnumerable<PrinterMapping> mappings)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var tx = conn.BeginTransaction();
            using (var del = conn.CreateCommand())
            {
                del.Transaction = tx;
                del.CommandText = "DELETE FROM printers";
                del.ExecuteNonQuery();
            }

            using (var ins = conn.CreateCommand())
            {
                ins.Transaction = tx;
                ins.CommandText =
                    "INSERT INTO printers(windows_name, color_mode, default_paper_size) VALUES($n, $c, $p)";
                var pName = ins.Parameters.Add("$n", SqliteType.Text);
                var pColor = ins.Parameters.Add("$c", SqliteType.Text);
                var pPaper = ins.Parameters.Add("$p", SqliteType.Text);
                foreach (var mapping in mappings)
                {
                    pName.Value = mapping.WindowsName;
                    pColor.Value = mapping.ColorMode;
                    pPaper.Value = mapping.DefaultPaperSize ?? string.Empty;
                    ins.ExecuteNonQuery();
                }
            }

            tx.Commit();
        }
    }

    /// <summary>Whether this job id was already printed by this device (duplicate prevention).</summary>
    public bool IsJobCompleted(string jobId)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(1) FROM completed_jobs WHERE job_id = $id";
            cmd.Parameters.AddWithValue("$id", jobId);
            return Convert.ToInt64(cmd.ExecuteScalar()) > 0;
        }
    }

    /// <summary>Records a job id as completed so it can never be printed twice.</summary>
    public void MarkJobCompleted(string jobId, string orderNumber, string note)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO completed_jobs(job_id, order_number, completed_at, note)
                VALUES($id, $order, $at, $note)
                ON CONFLICT(job_id) DO NOTHING
                """;
            cmd.Parameters.AddWithValue("$id", jobId);
            cmd.Parameters.AddWithValue("$order", orderNumber ?? string.Empty);
            cmd.Parameters.AddWithValue("$at", DateTime.UtcNow.ToString("O"));
            cmd.Parameters.AddWithValue("$note", note ?? string.Empty);
            cmd.ExecuteNonQuery();
        }
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private void Initialize()
    {
        lock (_gate)
        {
            using var conn = Open();
            foreach (var sql in SchemaStatements)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                cmd.ExecuteNonQuery();
            }

            // Keep the completed-jobs table small: entries older than the retention
            // window can be dropped — the server never re-queues jobs that old.
            using var prune = conn.CreateCommand();
            prune.CommandText = "DELETE FROM completed_jobs WHERE completed_at < $cutoff";
            prune.Parameters.AddWithValue("$cutoff", DateTime.UtcNow.AddDays(-CompletedJobsRetentionDays).ToString("O"));
            prune.ExecuteNonQuery();
        }
    }
}
