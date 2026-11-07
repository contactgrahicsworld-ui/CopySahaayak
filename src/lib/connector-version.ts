// Single source of truth for the latest Desktop Sahaayak (Windows connector) release.
// scripts/publish-release.sh rewrites this together with the connector csproj when a
// new version is published — the version endpoint and any UI stay in lockstep.
export const CONNECTOR_VERSION = '1.6.1'

// Relative download URL the Windows connector resolves against its own server URL.
export const CONNECTOR_DOWNLOAD_PATH = '/api/downloads/connector'

// SHA-256 and byte size of the released DesktopSahaayak-Setup.exe. These are filled
// in by scripts/publish-release.sh AFTER the CI-built release assets are downloaded
// and verified — an empty string means "not verified yet" and the endpoint omits
// them, so the connector skips its checksum check instead of failing.
export const CONNECTOR_SETUP_SHA256 = 'b42585fa3460c29f8a9cacbb6243456e60cfd1502ea6f6e783c88eac897604be'

export const CONNECTOR_SETUP_SIZE_BYTES = 52122554
