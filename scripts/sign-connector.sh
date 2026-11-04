#!/usr/bin/env bash
#
# Authenticode-signs the Windows connector executables (installer + portable).
#
# Certificate sources (first available wins):
#   1. PEM pair   : CONNECTOR_SIGN_CERT (pem) + CONNECTOR_SIGN_KEY (pem/key)
#   2. PKCS#12    : CONNECTOR_SIGN_PFX (.pfx/.p12) + CONNECTOR_SIGN_PASS
#
# RFC-3161 timestamping is always applied (signature stays valid after the
# certificate expires): http://timestamp.digicert.com
#
# Usage:
#   scripts/sign-connector.sh <file.exe> [more.exe ...]
#
# SmartScreen reality check:
#   - Self-signed/test certs DO NOT remove the SmartScreen warning.
#   - EV certificate (e.g. Azure Trusted Signing, DigiCert EV): instant reputation.
#   - OV certificate: reputation builds after enough clean downloads/installs.
#
set -euo pipefail

OSSLSIGN="${OSSLSIGN:-$HOME/.local/ossl/usr/bin/osslsigncode}"
TS_URL="${TS_URL:-http://timestamp.digicert.com}"

if [[ ! -x "$OSSLSIGN" ]]; then
  echo "ERROR: osslsigncode not found at $OSSLSIGN" >&2
  echo "Install once with:" >&2
  echo "  apt-get download osslsigncode && dpkg -x osslsigncode_*.deb \$HOME/.local/ossl" >&2
  exit 1
fi

CERT_ARGS=()
if [[ -n "${CONNECTOR_SIGN_CERT:-}" && -n "${CONNECTOR_SIGN_KEY:-}" ]]; then
  [[ -f "$CONNECTOR_SIGN_CERT" ]] || { echo "ERROR: cert not found: $CONNECTOR_SIGN_CERT" >&2; exit 1; }
  [[ -f "$CONNECTOR_SIGN_KEY" ]] || { echo "ERROR: key not found: $CONNECTOR_SIGN_KEY" >&2; exit 1; }
  CERT_ARGS=(-certs "$CONNECTOR_SIGN_CERT" -key "$CONNECTOR_SIGN_KEY")
elif [[ -n "${CONNECTOR_SIGN_PFX:-}" ]]; then
  [[ -f "$CONNECTOR_SIGN_PFX" ]] || { echo "ERROR: pfx not found: $CONNECTOR_SIGN_PFX" >&2; exit 1; }
  CERT_ARGS=(-pkcs12 "$CONNECTOR_SIGN_PFX" -pass "${CONNECTOR_SIGN_PASS:?CONNECTOR_SIGN_PASS required}")
else
  echo "ERROR: no signing certificate configured." >&2
  echo "Set CONNECTOR_SIGN_CERT+CONNECTOR_SIGN_KEY (PEM) or CONNECTOR_SIGN_PFX+CONNECTOR_SIGN_PASS." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file.exe> [more.exe ...]" >&2
  exit 1
fi

for f in "$@"; do
  [[ -f "$f" ]] || { echo "ERROR: not a file: $f" >&2; exit 1; }
  tmp="${f}.signed.tmp"
  echo "==> Signing $(basename "$f")"
  "$OSSLSIGN" sign "${CERT_ARGS[@]}" \
    -t "$TS_URL" \
    -in "$f" -out "$tmp" \
    -n "${CONNECTOR_SIGN_DESC:-Desktop Sahaayak}" \
    -i "https://copysahaayak.vercel.app"
  mv -f "$tmp" "$f"
  echo "==> Verifying $(basename "$f")"
  # Plain verify works for public-CA (OV/EV) certs. For self-signed/private
  # chains (test pipeline) the signer cert itself is the trust anchor, so
  # retry with -CAfile. Both paths must succeed before we call it signed.
  if "$OSSLSIGN" verify -in "$f" >/dev/null 2>&1; then
    echo "    signature OK (public CA chain)"
  else
    ca="$CONNECTOR_SIGN_CERT"
    if [[ -z "$ca" && -n "${CONNECTOR_SIGN_PFX:-}" ]]; then
      ca="$(mktemp /tmp/sign-cert.XXXX.pem)"
      openssl pkcs12 -in "$CONNECTOR_SIGN_PFX" -nokeys -passin "pass:${CONNECTOR_SIGN_PASS:-}" -out "$ca" 2>/dev/null
    fi
    if [[ -n "$ca" && -f "$ca" ]] && "$OSSLSIGN" verify -CAfile "$ca" -in "$f" >/dev/null 2>&1; then
      echo "    signature OK (self-signed/private chain — SmartScreen reputation N/A until a CA cert is used)"
    else
      echo "ERROR: signature verification FAILED for $f" >&2
      exit 1
    fi
  fi
done

echo "==> All binaries signed and verified."
