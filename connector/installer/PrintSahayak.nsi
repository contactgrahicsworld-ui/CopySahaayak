; PrintSahayak Connector — NSIS 3 installer script
; Self-contained: uses only built-in NSIS instructions + MUI2 (no plugin DLLs).
; Build (from this directory):
;   makensis -V2 PrintSahayak.nsi
; Produces: PrintSahayak-Setup.exe  (expects ..\publish\PrintSahayakConnector.exe)
;
; Upgrade notes: this installer also removes the pre-rename "Photocopy Shop
; Connector" install (old dir + registry) and keeps the legacy
; photocopyconnector:// protocol working by pointing it at the new exe.

Unicode true
ManifestDPIAware true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define PRODUCT_NAME        "PrintSahayak Connector"
!define PRODUCT_VERSION     "1.2.0"
!define PRODUCT_PUBLISHER   "PrintSahayak Platforms"
!define PRODUCT_EXE         "PrintSahayakConnector.exe"
!define PRODUCT_UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintSahayakConnector"
!define PROTOCOL_KEY        "Software\Classes\printsahayak"
!define LEGACY_PROTOCOL_KEY "Software\Classes\photocopyconnector"
!define LEGACY_EXE          "PhotocopyShopConnector.exe"
!define LEGACY_DIR          "$PROGRAMFILES64\PhotocopyShopConnector"
!define LEGACY_UNINST_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhotocopyShopConnector"
!define RUN_KEY             "Software\Microsoft\Windows\CurrentVersion\Run"
!define RUN_VALUE           "PrintSahayakConnector"
!define LEGACY_RUN_VALUE    "PhotocopyShopConnector"

!include "MUI2.nsh"

Name "${PRODUCT_NAME}"
OutFile "PrintSahayak-Setup.exe"
InstallDir "$PROGRAMFILES64\PrintSahayak"
ShowInstDetails show
ShowUnInstDetails nevershow

VIProductVersion "1.2.0.0"
VIAddVersionKey /LANG=1033 ProductName      "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 ProductVersion   "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 FileVersion      "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 FileDescription  "Installer for the ${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 CompanyName      "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1033 LegalCopyright   "MIT License - Copyright (c) 2026 ${PRODUCT_PUBLISHER}"

!define MUI_ICON   "..\PrintSahayakConnector\app.ico"
!define MUI_UNICON "..\PrintSahayakConnector\app.ico"
!define MUI_ABORTWARNING

!define MUI_FINISHPAGE_RUN        "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT   "Start ${PRODUCT_NAME} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "License.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Install
; ---------------------------------------------------------------------------
Section "Install" SecInstall
  SetOutPath "$INSTDIR"
  File "License.txt"

  ; Stop running instances (new + legacy names) so executables are not locked.
  DetailPrint "Stopping any running instances…"
  nsExec::Exec 'taskkill /IM ${PRODUCT_EXE} /F'
  Pop $0
  nsExec::Exec 'taskkill /IM ${LEGACY_EXE} /F'
  Pop $0
  Sleep 500

  ; Silently remove the pre-rename build if it is installed.
  IfFileExists "${LEGACY_DIR}\Uninstall.exe" 0 no_legacy
    DetailPrint "Removing previous Photocopy Shop Connector install…"
    nsExec::Exec '"${LEGACY_DIR}\Uninstall.exe" /S'
    Pop $0
    Sleep 1500
  no_legacy:

  File "..\publish\${PRODUCT_EXE}"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"

  ; ---------------------------------------------------------------------------
  ; Deep link protocol: printsahayak://pair?server=…&code=…
  ; The legacy photocopyconnector:// scheme is ALSO registered (pointing at the
  ; new exe) so pairing links opened from an old dashboard tab keep working.
  ; Registered per-user (HKCU) so the browser can hand pairing links to the app.
  ; ---------------------------------------------------------------------------
  WriteRegStr HKCU "${PROTOCOL_KEY}" "" "URL:${PRODUCT_NAME}"
  WriteRegStr HKCU "${PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr HKCU "${PROTOCOL_KEY}\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr HKCU "${PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXE}" "%1"'

  WriteRegStr HKCU "${LEGACY_PROTOCOL_KEY}" "" "URL:${PRODUCT_NAME}"
  WriteRegStr HKCU "${LEGACY_PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr HKCU "${LEGACY_PROTOCOL_KEY}\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr HKCU "${LEGACY_PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXE}" "%1"'

  ; ---------------------------------------------------------------------------
  ; Add/Remove Programs entry
  ; ---------------------------------------------------------------------------
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "DisplayName"         "${PRODUCT_NAME}"
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "DisplayVersion"     "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "Publisher"          "${PRODUCT_PUBLISHER}"
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "DisplayIcon"        "$INSTDIR\${PRODUCT_EXE}"
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "UninstallString"    '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr   HKLM "${PRODUCT_UNINST_KEY}" "InstallLocation"    "$INSTDIR"
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "NoModify"           0x00000001
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "NoRepair"           0x00000001
  SectionGetSize ${SecInstall} $0
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "EstimatedSize"       $0

  ; Clear the legacy Add/Remove entry left behind by the old installer.
  DeleteRegKey HKLM "${LEGACY_UNINST_KEY}"
  DeleteRegValue HKCU "${RUN_KEY}" "${LEGACY_RUN_VALUE}"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ---------------------------------------------------------------------------
; Uninstall
; ---------------------------------------------------------------------------
Section "Uninstall"
  ; Stop a running instance before deleting files (best effort, both names).
  DetailPrint "Stopping ${PRODUCT_NAME}…"
  nsExec::Exec 'taskkill /IM ${PRODUCT_EXE} /F'
  Pop $0
  nsExec::Exec 'taskkill /IM ${LEGACY_EXE} /F'
  Pop $0
  Sleep 500

  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"
  RMDir  "${LEGACY_DIR}"

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"

  DeleteRegKey HKCU "${PROTOCOL_KEY}"
  DeleteRegKey HKCU "${LEGACY_PROTOCOL_KEY}"
  DeleteRegValue HKCU "${RUN_KEY}" "${RUN_VALUE}"
  DeleteRegValue HKCU "${RUN_KEY}" "${LEGACY_RUN_VALUE}"
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"

  ; Note: pairing data and logs in %APPDATA%\PrintSahayakConnector are kept on
  ; purpose so a reinstall does not force re-pairing. Remove them by hand if needed.
SectionEnd
