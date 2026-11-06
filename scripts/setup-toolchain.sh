#!/usr/bin/env bash
# Reinstalls the connector build toolchain after a sandbox recycle:
#   1. .NET SDK 8.0.427  -> ~/.dotnet   (official dotnet-install.sh, checksum-validated)
#   2. NSIS (Debian debs) -> ~/.local/nsis
# Then runs scripts/build-connector.sh to produce the 1.4.0 artifacts.
set -euo pipefail

LOG_STAMP() { echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 1. .NET SDK ----------
if [[ ! -x "$HOME/.dotnet/dotnet" ]]; then
  LOG_STAMP "Installing .NET SDK 8.0.427 ..."
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --version 8.0.427 --install-dir "$HOME/.dotnet" --no-path
  LOG_STAMP "dotnet version: $("$HOME/.dotnet/dotnet" --version)"
else
  LOG_STAMP "dotnet already present"
fi

# ---------- 2. NSIS ----------
if [[ ! -x "$HOME/.local/nsis/usr/bin/makensis" ]]; then
  LOG_STAMP "Installing NSIS from Debian pool ..."
  mkdir -p /tmp/nsis-debs ~/.local/nsis
  BASE="http://deb.debian.org/debian/pool/main/n/nsis"
  # Discover current .deb filenames from the pool listing
  curl -sSL "$BASE/" | grep -oE 'nsis[a-z-]*_[0-9.]+[^"<"]*_amd64\.deb|nsis[a-z-]*_[0-9.]+[^"<"]*_all\.deb' | sort -u > /tmp/nsis-debs/list.txt
  LOG_STAMP "Found debs:"; cat /tmp/nsis-debs/list.txt
  # We need: nsis-common (data), nsis (makensis, amd64). pluginapi optional.
  for f in $(grep -E '^nsis-common_' /tmp/nsis-debs/list.txt | tail -1) \
           $(grep -E '^nsis_[0-9]' /tmp/nsis-debs/list.txt | grep '_amd64' | tail -1) \
           $(grep -E '^nsis-pluginapi_' /tmp/nsis-debs/list.txt | grep '_amd64' | tail -1); do
    LOG_STAMP "Downloading $f"
    curl -sSL "$BASE/$f" -o "/tmp/nsis-debs/$f"
    dpkg-deb -x "/tmp/nsis-debs/$f" "$HOME/.local/nsis"
  done
  LOG_STAMP "makensis version: $("$HOME/.local/nsis/usr/bin/makensis" -VERSION)"
else
  LOG_STAMP "nsis already present"
fi

# ---------- 3. Build connector ----------
LOG_STAMP "Building connector ..."
export PATH="$HOME/.dotnet:$HOME/.local/nsis/usr/bin:$PATH"
export NSISDIR="$HOME/.local/nsis/usr/share/nsis"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
bash /home/z/my-project/scripts/build-connector.sh

LOG_STAMP "ALL DONE"
