namespace PrintSahayakConnector.Core;

/// <summary>
/// Guarantees that only one instance of the connector runs per Windows session.
/// A second launch can forward a <c>photocopyconnector://</c> deep link to the
/// first instance via <see cref="PairingHint"/> before exiting.
/// </summary>
public sealed class SingleInstanceGuard : IDisposable
{
    private const string MutexName = @"Local\PrintSahayakConnector.SingleInstance";

    private readonly Mutex _mutex;

    /// <summary>True when this process owns the single-instance mutex.</summary>
    public bool IsFirstInstance { get; }

    public SingleInstanceGuard()
    {
        _mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        IsFirstInstance = createdNew;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (IsFirstInstance)
        {
            try { _mutex.ReleaseMutex(); }
            catch (ApplicationException)
            {
                // Thread did not own the mutex — nothing to release.
            }
        }

        _mutex.Dispose();
    }
}
