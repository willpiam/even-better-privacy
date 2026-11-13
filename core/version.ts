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
  detailProof: 2,
  revocationCertificate: 2,
  hierarchyCertificate: 2,
  signature: 2,
  signedMessage: 2,
  encryptedMessage: 1,
  encryptedSignedMessage: 1,
  encryptedSignedMessageMulti: 2,
  encryptedFile: 1,
  encryptedSignedFile: 1,
  fileCleartextEnvelope: 1,
  encryptedEmailAttachment: 1,
  encryptedSignedEmailAttachment: 1,
  encryptedSignedEmailAttachmentMulti: 1,
  emailAttachmentCleartextEnvelope: 1,
  emergencyRevocationCertificate: 2,
  aesCiphertext: 4,
} as const;
