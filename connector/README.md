# Photocopy Shop Connector (Windows)

A small Windows tray application that connects the printers of a photocopy shop to the
**Photocopy Shop Automation SaaS**. Once paired and installed, it polls the shop server
for print jobs, downloads the documents, prints them on the right printer (verified
through the Windows print spooler) and reports the result back to the server.

- **No .NET installation required** — the connector ships as a self-contained
  single-file executable.
- Runs entirely in the system tray; configuration happens through small dialogs.
- Stores its state (pairing, printer mapping, dedupe list, logs) under
  `%APPDATA%\PhotocopyShopConnector`.

---

## 1. Installation

### Option A — Setup installer (recommended)

1. Download `PhotocopyShopConnector-Setup.exe` from the shop dashboard (or the GitHub
   release page).
2. Run the installer. Windows may show a **SmartScreen** warning for the unsigned
   binary — see [SmartScreen](#5-windows-defender-smartscreen-blocked-the-install)
   below.
3. The installer
   - copies `PhotocopyShopConnector.exe` to `C:\Program Files\PhotocopyShopConnector`,
   - creates Start Menu and Desktop shortcuts,
   - registers the `photocopyconnector://` protocol handler (so one-click pairing
     links from the dashboard work),
   - registers the app in *Add/Remove Programs* (with an uninstaller).
4. On the finish page tick **Start Photocopy Shop Connector now** — the pairing
   dialog opens.

### Option B — Portable executable

1. Download `PhotocopyShopConnector-portable.exe`.
2. Put it into any folder the user may write to (e.g. `C:\Tools\PhotocopyShopConnector`).
3. Double-click it. Without the installer the `photocopyconnector://` protocol is not
   registered — pairing links from the dashboard will not open the app; pair with a
   manual code instead.

### First start

On the first start (or from the tray menu → **Pair with Shop…**) the pairing dialog
asks for:

| Field | Meaning |
|---|---|
| Shop server URL | Base URL of the SaaS, e.g. `https://print.myshop.com` |
| Pairing code | 6-character, one-time code from the dashboard (Devices → Pair a device) |
| Name of this computer | Friendly name shown in the dashboard |
| Start with Windows | Writes/removes the HKCU `Run` key |

Pairing links of the form
`photocopyconnector://pair?server=<url>&code=<code>` prefill the whole dialog — just
confirm the computer name and click **Pair**.

## 2. Printer mapping

Open the tray menu → **Printer Settings…**. Every Windows printer installed on the
machine is listed with three settings per row:

- **Use** — only ticked printers are reported to the server and can receive jobs.
- **Colour mode** — `BW` (force greyscale, saves colour toner), `COLOR`, or
  `ANY` (accepts every job).
- **Default paper** — `A4`, `A3`, `A5`, `US Legal`, `US Letter`, or *(printer default)*.

Click **Save** — the mapping is stored locally and pushed to the server immediately
(heartbeat). The job router then picks printers as follows:

1. the printer the dashboard explicitly assigned to the job (if installed locally),
2. a locally mapped printer whose colour mode matches the job (BW/COLOR, then ANY),
3. the Windows default printer as a last resort.

## 3. How it works

- **Heartbeat** every ~20 s: reports the printer mapping and the app version, and
  learns whether the device is still `ACTIVE` (a revoked device stops working and
  asks to be re-paired).
- **Job claim** every ~15 s (or via *Check for Jobs Now*): downloads the document,
  renders it page by page (PDF via pdfium, images directly), applies greyscale when
  the job requests `BW`, prints with copies / duplex / paper size / page range, and
  reports `SPOOLING` → `COMPLETED`/`FAILED`.
- **Spooler-verified honesty**: `COMPLETED` is only ever reported after the Windows
  print spooler confirmed the job was printed (it left the queue or reached the
  PRINTED/COMPLETE state). A job that is printed twice by accident is suppressed
  locally (30-day dedupe list).

Logs: tray menu → **Open Logs** (daily files in `%APPDATA%\PhotocopyShopConnector\Logs`).

## 4. Troubleshooting

### Job stays QUEUED on the server, nothing prints

1. Is the tray icon present and green? Double-click it → **Connection** should read
   *Connected — watching for jobs*.
2. **Last heartbeat** in the status window shows when the server last heard from the
   device. If it is old or says *Connection problem — retrying*: check the server URL
   and the shop's internet connection; corporate firewalls/proxies must allow
   HTTPS to the SaaS host.
3. The device may have been **revoked** (balloon message *Revoked by the shop admin*)
   — pair again via *Pair with Shop…* with a fresh code.
4. No printer ticked in **Printer Settings…**? The server will not route jobs to a
   device without printers.
5. Click *Check for Jobs Now* and watch the logs (`Open Logs`) for claim/download/print
   errors.

### The job printed blank pages

- Try printing the same document locally from Adobe Reader / an image viewer to rule
  out a driver problem.
- Some drivers do not handle scaled bitmaps well at their default DPI — set an
  explicit **Default paper** in *Printer Settings…* and retry.
- Mixed greyscale/color jobs on GDI-only printers occasionally blank out on huge
  pages; enable *UseTiling*-like behaviour by reducing the page size (A3 → A4) or ask
  the shop admin to send the document as PDF instead of an image.
- Check the log file — render errors ("Could not render page N") indicate a corrupt or
  password-protected document.

### The job prints on the wrong printer

- The dashboard assigned printer wins, but only when it is installed **with the exact
  same name** on this computer (check *Printer Settings…* — the name column must match
  the server name; Windows network printers often carry a suffix like ` on PC01`).
- Colour routing uses the mapping's colour mode: a `BW` job goes to a `BW` (or `ANY`)
  printer. If every job lands on the same device, give each printer an explicit mode
  instead of `ANY`.
- Without any matching mapping the connector falls back to the **Windows default
  printer** — set it deliberately (Settings → Printers).

### Windows Defender SmartScreen blocked the install

The installer/exe is **not code-signed**. SmartScreen shows
*"Windows protected your PC"*.

1. Click **More info** → **Run anyway** (per-machine decision).
2. Admins can pre-approve the file: right-click the `.exe` → *Properties* → tick
   *Unblock*, or `Unblock-File -Path .\PhotocopyShopConnector-Setup.exe` in
   PowerShell.
3. Longer term: sign the binaries with an Authenticode certificate in the build
   pipeline (see `.github/workflows/build-connector.yml`).

### Pairing code rejected / expired

- Pairing codes are **one-time and short-lived** (usually a few minutes). Generate a
  fresh code in the dashboard (Devices → Pair a device) and pair immediately.
- A code that was already used, mistyped, or generated for a different shop is
  rejected by the server — the dialog shows the server's message.
- Codes are 6 characters, letters/digits; the input field upper-cases automatically.

## 5. Data & privacy

- `%APPDATA%\PhotocopyShopConnector\state.db` — SQLite: server URL, device token,
  printer mapping, dedupe list. **Keep it private** — anyone holding the device token
  can print to this machine.
- `%APPDATA%\PhotocopyShopConnector\Logs\` — rolling 30-day log.
- Uninstalling does **not** delete this data (so reinstalling does not force
  re-pairing). Delete the folder manually to fully reset the device.

## 6. Building from source

```bash
scripts/build-connector.sh
# → connector/publish/PhotocopyShopConnector.exe          (portable, self-contained)
# → connector/installer/PhotocopyShopConnector-Setup.exe  (NSIS installer)
# → download/connector/…  (copies + sha256)
```

Requirements: .NET 8 SDK (`~/.dotnet`) and NSIS 3 (`~/.local/nsis/usr/bin`).
Windows CI: `.github/workflows/build-connector.yml` (windows-latest, .NET 8, NSIS via
Chocolatey) builds the same artifacts on every push and attaches them to tag releases.
