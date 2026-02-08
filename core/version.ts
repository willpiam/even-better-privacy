/**
 * Global Version
 *
 * Single source of truth for all component, protocol, and file format versions.
 * Bump this for any change that should be reflected everywhere.
 *
 * Versioning scheme: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes to identity format or cryptographic schemes
 * - MINOR: New features that are backwards compatible
 * - PATCH: Bug fixes
 */
export const GLOBAL_VERSION = "0.0.1";
export const PROTOCOL_VERSION = GLOBAL_VERSION;

/**
 * Application/component versions.
 * Keep these in sync across all entrypoints (server, GUI, CLI, email plugin).
 */
export const APP_VERSION = GLOBAL_VERSION;
export const COMPONENT_VERSIONS = {
    server: APP_VERSION,
    cli: APP_VERSION,
    gui: APP_VERSION,
    guiLocalBackend: APP_VERSION,
    emailPlugin: APP_VERSION,
} as const;

/**
 * File/payload/ciphertext format versions.
 */
export const FILE_FORMAT_VERSIONS = {
    identityStorage: GLOBAL_VERSION,
    publicIdentity: GLOBAL_VERSION,
    signature: GLOBAL_VERSION,
    signedMessage: GLOBAL_VERSION,
    encryptedMessage: GLOBAL_VERSION,
    encryptedSignedMessage: GLOBAL_VERSION,
    emergencyRevocationCertificate: GLOBAL_VERSION,
    aesCiphertext: GLOBAL_VERSION,
} as const;

/**
 * Minimum protocol version that this implementation can read/process.
 * Used for backwards compatibility checks.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = GLOBAL_VERSION;

/**
 * Check if a protocol version is supported by this implementation.
 */
export function isProtocolVersionSupported(version: string): boolean {
    const [major, minor] = version.split('.').map(Number);
    const [minMajor, minMinor] = MIN_SUPPORTED_PROTOCOL_VERSION.split('.').map(Number);
    
    if (major < minMajor) return false;
    if (major === minMajor && minor < minMinor) return false;
    return true;
}

/**
 * Compare two protocol versions.
 * Returns: negative if a < b, 0 if a === b, positive if a > b
 */
export function compareProtocolVersions(a: string, b: string): number {
    const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
    const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
    
    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return (aPatch || 0) - (bPatch || 0);
}

