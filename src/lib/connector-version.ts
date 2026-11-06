// Single source of truth for the latest Desktop Sahaayak (Windows connector) release.
// scripts/publish-release.sh rewrites this together with the connector csproj when a
// new version is published — the version endpoint and any UI stay in lockstep.
export const CONNECTOR_VERSION = '1.5.0'

// Relative download URL the Windows connector resolves against its own server URL.
export const CONNECTOR_DOWNLOAD_PATH = '/api/downloads/connector'
