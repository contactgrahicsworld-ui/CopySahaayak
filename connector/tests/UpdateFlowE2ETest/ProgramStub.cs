// Stand-in for the real Program.cs (whose Main would clash with the test's
// top-level statements). Only the two static members the included production
// files reference are reproduced — the same values as a 1.6.0 build.
namespace PrintSahayakConnector;

internal static class Program
{
    public const string AppTitle = "Desktop Sahaayak";

    public static string AppVersion => "1.6.0";
}
