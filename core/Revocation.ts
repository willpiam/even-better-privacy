import { DilithiumSigningKey } from "./Dilithium.ts";
import { SphincsSigningKey } from "./Sphincs.ts";
import { buildMessageHashEnvelope } from "./MessageHash.ts";
import { stringToHex, hexToString } from "./Hex.ts";

/**
 * Types of revocations supported by the system
 */
export type RevocationType = "detail" | "identity";

/**
 * Base structure for a revocation certificate
 */
export interface RevocationCertificateData {
	type: RevocationType;
	fingerprint: string;       // Identity fingerprint
	nonce: number;             // Monotonically increasing nonce
	timestamp: number;         // Unix timestamp in milliseconds
	reason?: string;           // Optional human-readable reason
	target?: string;           // For detail revocations, the path being revoked
	signature: string | null;  // Signature over the certificate (null before signing)
}

/**
 * A signed revocation certificate
 */
export interface SignedRevocationCertificate extends RevocationCertificateData {
	signature: string;
}

/**
 * Payload format for detail revocations (includes the last known detail value/proof)
 */
export interface DetailRevocationPayload {
	certificate: SignedRevocationCertificate;
	lastDetail?: string;       // The last known detail value (for verification)
	lastProof?: string;        // The last known proof (for verification)
}

/**
 * Payload format for identity revocations
 */
export interface IdentityRevocationPayload {
	certificate: SignedRevocationCertificate;
}

/**
 * Result of revocation verification
 */
export type RevocationVerifyResult = 
	| { ok: true; certificate: SignedRevocationCertificate }
	| { ok: false; error: string };

/**
 * Create an unsigned revocation certificate
 */
export function createRevocationCertificate(
	type: RevocationType,
	fingerprint: string,
	nonce: number,
	options?: {
		reason?: string;
		target?: string;
	}
): RevocationCertificateData {
	return {
		type,
		fingerprint,
		nonce,
		timestamp: Date.now(),
		reason: options?.reason,
		target: options?.target,
		signature: null,
	};
}

/**
 * Get the message to sign for a revocation certificate
 */
export function getRevocationSignaturePayload(cert: RevocationCertificateData): string {
	// Create a copy with signature set to null for signing
	const payload: RevocationCertificateData = {
		type: cert.type,
		fingerprint: cert.fingerprint,
		nonce: cert.nonce,
		timestamp: cert.timestamp,
		reason: cert.reason,
		target: cert.target,
		signature: null,
	};
	return JSON.stringify(payload);
}

/**
 * Encode a signed revocation certificate to hex-encoded JSON
 */
export function encodeRevocationCertificate(cert: SignedRevocationCertificate): string {
	return stringToHex(JSON.stringify(cert));
}

/**
 * Decode a hex-encoded revocation certificate
 */
export function decodeRevocationCertificate(encoded: string): SignedRevocationCertificate | null {
	try {
		const json = hexToString(encoded);
		const cert = JSON.parse(json) as SignedRevocationCertificate;
		
		// Validate structure
		if (
			typeof cert.type !== "string" ||
			(cert.type !== "detail" && cert.type !== "identity") ||
			typeof cert.fingerprint !== "string" ||
			typeof cert.nonce !== "number" ||
			typeof cert.timestamp !== "number" ||
			typeof cert.signature !== "string"
		) {
			return null;
		}
		
		return cert;
	} catch {
		return null;
	}
}

/**
 * Verify a revocation certificate signature
 */
export function verifyRevocationCertificate(
	cert: SignedRevocationCertificate,
	signingKeyType: "dilithium" | "sphincs",
	signingKey: string,
	variant: string,
): RevocationVerifyResult {
	// Validate basic structure
	if (!cert.signature || typeof cert.signature !== "string") {
		return { ok: false, error: "missing signature" };
	}

	if (typeof cert.nonce !== "number" || !Number.isInteger(cert.nonce) || cert.nonce < 0) {
		return { ok: false, error: "invalid nonce" };
	}

	if (typeof cert.timestamp !== "number" || !Number.isFinite(cert.timestamp)) {
		return { ok: false, error: "invalid timestamp" };
	}

	if (cert.type !== "detail" && cert.type !== "identity") {
		return { ok: false, error: "invalid revocation type" };
	}

	if (cert.type === "detail" && typeof cert.target !== "string") {
		return { ok: false, error: "detail revocation must specify target path" };
	}

	// Verify signature
	const payload = getRevocationSignaturePayload(cert);
	const envelope = buildMessageHashEnvelope(payload);
	let verified = false;

	try {
		if (signingKeyType === "dilithium") {
			verified = DilithiumSigningKey.verify(variant, envelope, cert.signature, signingKey);
		} else {
			verified = SphincsSigningKey.verify(variant, envelope, cert.signature, signingKey);
		}
	} catch {
		return { ok: false, error: "signature verification failed" };
	}

	if (!verified) {
		return { ok: false, error: "invalid signature" };
	}

	return { ok: true, certificate: cert };
}

/**
 * Decode a hex-encoded revocation certificate and verify it against a signer.
 */
export function decodeAndVerifyRevocationCertificate(
	encodedCertificate: string,
	input: {
		signingKeyType: "dilithium" | "sphincs";
		signingKey: string;
		variant: string;
		expectedType?: RevocationType;
		expectedTarget?: string;
		expectedFingerprint?: string;
	},
): RevocationVerifyResult {
	const cert = decodeRevocationCertificate(encodedCertificate);
	if (!cert) {
		return { ok: false, error: "invalid certificate encoding" };
	}
	if (input.expectedType && cert.type !== input.expectedType) {
		return { ok: false, error: `expected ${input.expectedType} revocation, got ${cert.type}` };
	}
	if (input.expectedFingerprint && cert.fingerprint !== input.expectedFingerprint) {
		return { ok: false, error: "certificate fingerprint mismatch" };
	}
	if (input.expectedType === "detail" && input.expectedTarget && cert.target !== input.expectedTarget) {
		return { ok: false, error: "certificate target path mismatch" };
	}
	return verifyRevocationCertificate(
		cert,
		input.signingKeyType,
		input.signingKey,
		input.variant,
	);
}

/**
 * Check if a nonce is valid (greater than the highest seen nonce)
 */
export function isValidRevocationNonce(nonce: number, maxSeenNonce: number): boolean {
	return Number.isInteger(nonce) && nonce >= 0 && nonce > maxSeenNonce;
}

// F-CRYPTO-01: emergency revocation certificates (pre-signed at identity
// generation time and stored out-of-band) live in a separate nonce space
// above regular revocation nonces, so they cannot be silently "consumed"
// by a regular revocation issued first.
//
// 2 ** 31 is well above any reasonable regular-revocation counter, remains
// within the safe-integer range, and leaves room for additional emergency
// slots (EMERGENCY_NONCE_BASE + 1, +2, ...) without namespace collisions.
export const EMERGENCY_NONCE_BASE = 2 ** 31;

export function isEmergencyNonce(nonce: number): boolean {
	return Number.isInteger(nonce) && nonce >= EMERGENCY_NONCE_BASE;
}


