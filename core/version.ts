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
export const PROTOCOL_VERSION = "0.1.1";

/**
 * File/payload/ciphertext format versions.
 */
export const FILE_FORMAT_VERSIONS = {
  identityStorage: 2,
  publicIdentity: 1,
  hierarchyCertificate: 1,
  signature: 2,
  signedMessage: 2,
  encryptedMessage: 1,
  encryptedSignedMessage: 1,
  encryptedSignedMessageMulti: 1,
  encryptedFile: 1,
  encryptedSignedFile: 1,
  fileCleartextEnvelope: 1,
  encryptedEmailAttachment: 1,
  encryptedSignedEmailAttachment: 1,
  encryptedSignedEmailAttachmentMulti: 1,
  emailAttachmentCleartextEnvelope: 1,
  emergencyRevocationCertificate: 1,
  aesCiphertext: 4,
} as const;

/**
 * Minimum protocol version that this implementation can read/process.
 * Used for backwards compatibility checks.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = "0.0.1";

type ParsedProtocolVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseProtocolVersion(version: string): ParsedProtocolVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Check if a protocol version is supported by this implementation.
 *
 * Protocol compatibility is scoped to the current major version. Patch is
 * parsed and compared for malformed/stale-version rejection, but patch-only
 * differences are intentionally compatible.
 */
export function isProtocolVersionSupported(version: string): boolean {
  const parsed = parseProtocolVersion(version);
  const min = parseProtocolVersion(MIN_SUPPORTED_PROTOCOL_VERSION);
  const current = parseProtocolVersion(PROTOCOL_VERSION);
  if (!parsed || !min || !current) return false;

  if (parsed.major !== current.major) return false;
  if (compareProtocolVersions(version, MIN_SUPPORTED_PROTOCOL_VERSION) < 0) {
    return false;
  }
  return true;
}

/**
 * Compare two protocol versions.
 * Returns: negative if a < b, 0 if a === b, positive if a > b
 */
export function compareProtocolVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
  const [bMajor, bMinor, bPatch] = b.split(".").map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return (aPatch || 0) - (bPatch || 0);
}
