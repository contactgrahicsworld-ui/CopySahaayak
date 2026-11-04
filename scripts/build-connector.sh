#!/usr/bin/env bash
#
# Builds the Windows connector end-to-end on Linux:
#   1. dotnet publish  → single-file self-contained win-x64 exe
#   2. makensis        → PrintSahayak-Setup.exe
#   3. artifacts       → /home/z/my-project/download/connector/
#
set -euo pipefail

export PATH="$HOME/.dotnet:$HOME/.local/nsis/usr/bin:$PATH"
export NSISDIR="$HOME/.local/nsis/usr/share/nsis"

ROOT="/home/z/my-project"
PROJECT_DIR="$ROOT/connector/PrintSahayakConnector"
PUBLISH_DIR="$ROOT/connector/publish"
INSTALLER_DIR="$ROOT/connector/installer"
DOWNLOAD_DIR="$ROOT/download/connector"

echo "==> Toolchain"
echo "    dotnet : $(dotnet --version)"
echo "    nsis   : $(makensis -VERSION 2>/dev/null || echo MISSING)"

echo "==> dotnet publish (win-x64, self-contained single file)"
cd "$PROJECT_DIR"
dotnet publish -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishTrimmed=false \
  -o ../publish

EXE="$PUBLISH_DIR/PrintSahayakConnector.exe"
if [[ ! -f "$EXE" ]]; then
  echo "ERROR: publish output not found at $EXE" >&2
  exit 1
fi

echo "==> Verifying portable exe"
file "$EXE"
if ! file "$EXE" | grep -q "PE32"; then
  echo "ERROR: $EXE is not a Windows PE32 executable" >&2
  exit 1
fi

echo "==> NSIS installer"
cd "$INSTALLER_DIR"
makensis -V2 PrintSahayak.nsi

SETUP="$INSTALLER_DIR/PrintSahayak-Setup.exe"
if [[ ! -f "$SETUP" ]]; then
  echo "ERROR: installer output not found at $SETUP" >&2
  exit 1
fi

echo "==> Copying artifacts to $DOWNLOAD_DIR"
mkdir -p "$DOWNLOAD_DIR"
cp -f "$SETUP" "$DOWNLOAD_DIR/PrintSahayak-Setup.exe"
cp -f "$EXE"   "$DOWNLOAD_DIR/PrintSahayak-portable.exe"

echo "==> Artifacts"
for f in "$DOWNLOAD_DIR/PrintSahayak-Setup.exe" \
         "$DOWNLOAD_DIR/PrintSahayak-portable.exe"; do
  size=$(stat -c '%s' "$f")
  hash=$(sha256sum "$f" | awk '{print $1}')
  mib=$(awk "BEGIN{printf \"%.1f\", $size/1048576}")
  printf '%s\n  size   : %s bytes (%s MiB)\n  sha256 : %s\n' \
    "$f" "$size" "$mib" "$hash"
done

echo "==> Done."
