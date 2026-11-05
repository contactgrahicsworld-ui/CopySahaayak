using System.IO.MemoryMappedFiles;
using System.Text;

namespace PrintSahayakConnector.Core;

/// <summary>
/// Cross-process bridge so a second app launch (e.g. a <c>photocopyconnector://</c>
/// deep link clicked in the browser while the tray app is already running) can hand
/// the link to the first instance, which then opens the prefilled pairing dialog.
/// </summary>
public static class PairingHint
{
    private const string MmfName = "PrintSahayakConnector.PairingHint";
    private const string EventName = "PrintSahayakConnector.PairingHintEvent";
    private const int Capacity = 4096;

    /// <summary>Called by the short-lived second instance to publish a raw deep link.</summary>
    public static void Publish(string rawLink)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(rawLink);
            if (bytes.Length > Capacity - 4) return;

            using var mmf = MemoryMappedFile.CreateOrOpen(MmfName, Capacity);
            using var view = mmf.CreateViewAccessor(0, Capacity);
            view.Write(0, bytes.Length);
            view.WriteArray(4, bytes, 0, bytes.Length);

            using var evt = new EventWaitHandle(false, EventResetMode.AutoReset, EventName, out _);
            evt.Set();
            Logger.Info("Forwarded a pairing link to the running instance.");
        }
        catch (Exception ex)
        {
            Logger.Warn("Could not forward pairing link: " + ex.Message);
        }
    }

    /// <summary>
    /// Waits (polling, cancellable) for a deep link from a second instance.
    /// Returns the raw link, or null when cancelled / the listener failed.
    /// </summary>
    public static async Task<string?> WaitForLinkAsync(CancellationToken ct)
    {
        try
        {
            using var evt = new EventWaitHandle(false, EventResetMode.AutoReset, EventName, out _);
            while (!ct.IsCancellationRequested)
            {
                var signaled = await Task.Run(() => evt.WaitOne(1000), ct);
                if (!signaled) continue;

                using var mmf = MemoryMappedFile.CreateOrOpen(MmfName, Capacity);
                using var view = mmf.CreateViewAccessor(0, Capacity);
                var length = view.ReadInt32(0);
                if (length <= 0 || length > Capacity - 4) continue;

                var bytes = new byte[length];
                view.ReadArray(4, bytes, 0, length);
                view.Write(0, 0); // consume
                var link = Encoding.UTF8.GetString(bytes);
                // Accept both the current and the legacy scheme — a dashboard opened
                // before an upgrade still hands over photocopyconnector:// links.
                if (link.StartsWith(DeepLinkParser.Scheme + "://", StringComparison.OrdinalIgnoreCase) ||
                    link.StartsWith(DeepLinkParser.LegacyScheme + "://", StringComparison.OrdinalIgnoreCase))
                {
                    return link;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown — expected.
        }
        catch (Exception ex)
        {
            Logger.Warn("Pairing hint listener stopped: " + ex.Message);
        }

        return null;
    }
}
