/**
 * EBP Protocol Version
 * 
 * This version number identifies the protocol version used for identity storage,
 * message formats, and server API compatibility. Increment when making breaking
 * changes to any of these formats.
 * 
 * Versioning scheme: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes to identity format or cryptographic schemes
 * - MINOR: New features that are backwards compatible
 * - PATCH: Bug fixes
 */
export const PROTOCOL_VERSION = "0.0.1";

/**
 * Minimum protocol version that this implementation can read/process.
 * Used for backwards compatibility checks.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = "0.0.1";

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

