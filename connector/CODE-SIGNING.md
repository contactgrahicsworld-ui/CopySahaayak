# Code Signing — Desktop Sahaayak (Windows installer)

## Current state (v1.3.0)

| Item | Status |
| --- | --- |
| Signing pipeline (Linux) | ✅ `scripts/sign-connector.sh` (osslsigncode + RFC-3161 timestamp) |
| Signing pipeline (CI) | ✅ `.github/workflows/build-connector.yml` — auto-signs when secrets exist |
| Test-signed build | ✅ Both exes signed with a self-signed test cert and verified |
| Production certificate | ⏳ **Needs purchase (one-time payment — cannot be done from this sandbox)** |

## What removes the SmartScreen warning

Windows SmartScreen reputation comes from the **certificate type**, not just from being signed:

| Certificate | Cost (approx) | SmartScreen result |
| --- | --- | --- |
| Self-signed / test cert | free | ❌ No help — signed but still warns ("Unknown publisher") |
| **OV** code signing (Certum, SSL.com, Sectigo) | ₹5–15k/yr | ⚠️ Warns at first, reputation builds after enough clean downloads (days–weeks) |
| **EV** code signing (DigiCert EV, SSL.com EV) | ₹35–60k/yr | ✅ **Instant reputation — no warning** |
| **Azure Trusted Signing** (Microsoft) | **$9.99/month** (~₹850) | ✅ Microsoft-managed identity — reputation very fast. **Cheapest EV-class option.** |

**Recommended: Azure Trusted Signing** ($9.99/mo) — needs an Azure account with
identity validation (business or individual). Alternative for individuals:
Certum "Open Source Code Signing" (~€69/yr, OV).

## How to go live with a real certificate

### Option A — PFX/OV-EV certificate (CI auto-signing)

1. Buy the cert, export it as `.pfx` (with private key), base64 it:
   `base64 -w0 mycert.pfx > cert.b64`
2. Add **two GitHub repo secrets** (`Settings → Secrets and variables → Actions`):
   - `SIGNING_CERT_PFX` = contents of `cert.b64`
   - `SIGNING_CERT_PASS` = the PFX password
3. Push a tag (`connector-v1.3.1` …). CI signs both exes automatically and
   uploads them to the GitHub release.
4. Local builds: set `CONNECTOR_SIGN_PFX` + `CONNECTOR_SIGN_PASS` and run
   `scripts/sign-connector.sh <exe…>`.

### Option B — Azure Trusted Signing

1. Create the Trusted Signing account + certificate profile in Azure portal.
2. Sign on Windows with `signtool sign /dtr < TSA from Azure > /dlib
   Azure.CodeSigning.Dlib.dll ...` (Microsoft's `Azure.CodeSigning` NuGet), or
   download the signed artifacts from CI after adding the Azure secrets.
3. Wire into CI the same way (secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`, `AZURE_CODESIGNING_ACCOUNT`, profile name).

## Notes

- Every signature is **RFC-3161 timestamped** (DigiCert TSA) — signatures stay
  valid even after the certificate expires.
- The signature description is "Desktop Sahaayak" with URL
  `https://copysahaayak.vercel.app` — shown in the UAC prompt.
- Signing never happens with plaintext certs in the repo: secrets come from
  environment variables / GitHub secrets only, and the ephemeral PFX is
  deleted from the runner right after signing.
- To re-test the pipeline locally without a CA cert:
  ```bash
  openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
    -keyout k.pem -out c.pem -subj "/CN=Desktop Sahaayak Test/O=Test/C=IN" \
    -addext "extendedKeyUsage=codeSigning"
  CONNECTOR_SIGN_CERT=c.pem CONNECTOR_SIGN_KEY=k.pem \
    scripts/sign-connector.sh download/connector/*.exe
  ```
