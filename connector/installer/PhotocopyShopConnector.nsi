; Photocopy Shop Connector — NSIS 3 installer script
; Self-contained: uses only built-in NSIS instructions + MUI2 (no plugin DLLs).
; Build (from this directory):
;   makensis -V2 PhotocopyShopConnector.nsi
; Produces: PhotocopyShopConnector-Setup.exe  (expects ..\publish\PhotocopyShopConnector.exe)

Unicode true
ManifestDPIAware true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define PRODUCT_NAME        "Photocopy Shop Connector"
!define PRODUCT_VERSION     "1.0.0"
!define PRODUCT_PUBLISHER   "Photocopy Shop"
!define PRODUCT_EXE         "PhotocopyShopConnector.exe"
!define PRODUCT_UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\PhotocopyShopConnector"
!define PROTOCOL_KEY        "Software\Classes\photocopyconnector"
!define RUN_KEY             "Software\Microsoft\Windows\CurrentVersion\Run"
!define RUN_VALUE           "PhotocopyShopConnector"

!include "MUI2.nsh"

Name "${PRODUCT_NAME}"
OutFile "PhotocopyShopConnector-Setup.exe"
InstallDir "$PROGRAMFILES64\PhotocopyShopConnector"
ShowInstDetails show
ShowUnInstDetails nevershow

VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=1033 ProductName      "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 ProductVersion   "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 FileVersion      "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 FileDescription  "Installer for the ${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 CompanyName      "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1033 LegalCopyright   "© ${PRODUCT_PUBLISHER}"

!define MUI_ICON   "..\PhotocopyShopConnector\app.ico"
!define MUI_UNICON "..\PhotocopyShopConnector\app.ico"
!define MUI_ABORTWARNING

!define MUI_FINISHPAGE_RUN        "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT   "Start ${PRODUCT_NAME} now"

!insertmacro MUI_PAGE_WELCOME
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

  ; Stop a running instance so the executable is not locked (best effort).
  DetailPrint "Stopping any running instance…"
  nsExec::Exec 'taskkill /IM ${PRODUCT_EXE} /F'
  Pop $0
  Sleep 500

  File "..\publish\${PRODUCT_EXE}"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"

  ; ---------------------------------------------------------------------------
  ; Deep link protocol: photocopyconnector://pair?server=…&code=…
  ; Registered per-user (HKCU) so the browser can hand pairing links to the app.
  ; ---------------------------------------------------------------------------
  WriteRegStr HKCU "${PROTOCOL_KEY}" "" "URL:${PRODUCT_NAME}"
  WriteRegStr HKCU "${PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr HKCU "${PROTOCOL_KEY}\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr HKCU "${PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXE}" "%1"'

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

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ---------------------------------------------------------------------------
; Uninstall
; ---------------------------------------------------------------------------
Section "Uninstall"
  ; Stop a running instance before deleting files (best effort).
  DetailPrint "Stopping ${PRODUCT_NAME}…"
  nsExec::Exec 'taskkill /IM ${PRODUCT_EXE} /F'
  Pop $0
  Sleep 500

  Delete "$INSTDIR\${PRODUCT_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"

  DeleteRegKey HKCU "${PROTOCOL_KEY}"
  DeleteRegValue HKCU "${RUN_KEY}" "${RUN_VALUE}"
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"

  ; Note: pairing data and logs in %APPDATA%\PhotocopyShopConnector are kept on
  ; purpose so a reinstall does not force re-pairing. Remove them by hand if needed.
SectionEnd
