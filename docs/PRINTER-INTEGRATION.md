# Printer Integration (Windows Connector)

## Deliverable

- **`PhotocopyShopConnector-Setup.exe`** — NSIS installer (per-machine, Start Menu + Desktop
  shortcuts, `photocopyconnector://` protocol handler, Add/Remove Programs entry, uninstaller).
- Portable single-file `PhotocopyShopConnector.exe` (self-contained .NET 8, ~156 MB — no
  .NET/Node/Python installation needed on the shop PC).
- Source: [`connector/`](../connector/) · build: [`scripts/build-connector.sh`](../scripts/build-connector.sh) ·
  CI rebuild: [`.github/workflows/build-connector.yml`](../.github/workflows/build-connector.yml)
- Install & troubleshooting guide: [`connector/README.md`](../connector/README.md)

## Component map

| Module | Responsibility |
| --- | --- |
| `Api/ApiClient.cs` | HTTPS client: pair / heartbeat / claim / events, Bearer device token, retry+backoff |
| `Core/JobWorker.cs` | 20 s loop: heartbeat → claim → download → print → verify → report; exponential backoff offline |
| `Printing/PageSources.cs` | PDF → bitmaps via PDFtoImage (pdfium, 220 DPI, MIT); page-range support; image decode |
| `Printing/GrayscaleFilter.cs` | GDI+ ColorMatrix luminance conversion when the job is B/W |
| `Printing/PrintJobExecutor.cs` | PrintDocument: printer name, `PaperSize` (A4/A3/A5/Legal/Letter), `Duplex.Vertical`, copies (driver Copies, loop fallback), aspect-fill margins |
| `Printing/SpoolerMonitor.cs` | winspool.drv P/Invoke (OpenPrinterW/EnumJobsW): job matched by `DocumentName = PCS-…`; COMPLETED only when the job leaves the queue / reaches COMPLETE; ERROR/deleted/timeout → FAILED |
| `Core/LocalStore.cs` | SQLite: device token, printer mapping, **completed job IDs (duplicate prevention)** |
| `UI/*` | Tray context, Pairing dialog (code or `photocopyconnector://` deep link), printer mapping grid (B/W / Colour / Any), live status |

## Anti-duplicate & honesty rules

1. A claimed job takes a **10-minute lease**; expiry returns it to the queue.
2. Connector keeps completed job IDs locally — a re-claim reports `COMPLETED (dedupe)`.
3. Server-side state machine enforces `SPOOLING → COMPLETED`; a bare `COMPLETED` is a 409.
4. `FAILED` auto-requeues while `attempts < 3`; shop can also "Retry failed print jobs".

## Routing

Orders are routed at verification time by `RoutingRule` (colour+paper) → fallback printer
tagged `BW`/`COLOR`/`ANY` → single-printer fallback. The claim response names the exact
`windowsName`; the connector double-checks its local mapping for operator overrides.

## Build & verify (from Linux)

```bash
scripts/build-connector.sh
# → dotnet publish -r win-x64 --self-contained (single file, EnableWindowsTargeting)
# → makensis installer/PhotocopyShopConnector.nsi
# → download/connector/PhotocopyShopConnector-Setup.exe (sha256 printed)
```

The sandbox build is cross-compiled (PE32/PE32+ verified with `file`). What cannot be
verified on Linux is listed in the delivery report: GUI interaction, physical print output,
spooler behaviour on real Windows — hence the included GitHub Actions pipeline for rebuilds.
