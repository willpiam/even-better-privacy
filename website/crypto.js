// F-WEB-01: browser-side signature verification for the EBP website.
//
// Prior to this module the `website/verify.js` flow blindly trusted the
// server's `{"verified": true}` response, undermining EBP's "server is
// just a directory; trust is cryptographic" property. This module uses
// the same `@noble/post-quantum` primitives as `core/` to re-verify
// signatures client-side.
//
// The `computeIdentityFingerprint` / `isValidFingerprintBech32` helpers
// mirror `core/Fingerprint.ts` so the browser verifier can confirm that
// a public identity's signing+encryption keys actually correspond to
// its claimed fingerprint - matching the cross-checks the GUI's
// verify-file flow performs via `POST /identity/fingerprint-from-public`.
//
// Imports pull pinned-version browser ESM bundles from esm.sh. The site
// is static, so no build step is required.

import { ml_dsa87 } from "https://esm.sh/@noble/post-quantum@0.5.4/ml-dsa";
import { slh_dsa_sha2_256s } from "https://esm.sh/@noble/post-quantum@0.5.4/slh-dsa";
import { sha256 } from "https://esm.sh/@noble/hashes@1.8.0/sha2";
import { bech32 } from "https://esm.sh/bech32@2.0.0";

const encoder = new TextEncoder();

function bytesToHex(bytes) {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

function sha256Hex(message) {
	return bytesToHex(sha256(encoder.encode(message)));
}

function hexToBytes(hex) {
	if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
		throw new Error("invalid hex");
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	}
	return out;
}

// Current envelope matches `core/MessageHash.ts::buildPurposeHashEnvelope`
// for purpose "message". The legacy envelope is still accepted, matching
// `Identity.VerifySignature`.
function buildCurrentEnvelopeFromHash(messageHash, salt) {
	return `ebp::message::v1::${messageHash}::${salt ?? ""}`;
}

function buildLegacyEnvelopeFromHash(messageHash, salt) {
	return `ebp::messagehash::${messageHash}::${salt ?? ""}`;
}

function selectSigner(signingKeyType) {
	if (signingKeyType === "dilithium") return ml_dsa87;
	if (signingKeyType === "sphincs") return slh_dsa_sha2_256s;
	throw new Error(`unsupported signing key type: ${signingKeyType}`);
}

function base64ToBytes(b64) {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function concatBytes(a, b) {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

const FINGERPRINT_BYTE_LENGTH = 32;
const FINGERPRINT_HRPS = ["ebpdk", "ebpsk"];

function getFingerprintHrp(signingKeyType, encryptionKeyType) {
	if (encryptionKeyType !== "kyber") {
		throw new Error(`Unsupported encryption key type: ${encryptionKeyType}`);
	}
	if (signingKeyType === "dilithium") return "ebpdk";
	if (signingKeyType === "sphincs") return "ebpsk";
	throw new Error(`Unsupported signing key type: ${signingKeyType}`);
}

// Mirrors `core/Fingerprint.ts::computeIdentityMerkleRootRaw`. The signing
// leaf hashes the base64-decoded public key bytes. The encryption leaf
// hashes the hex-decoded Kyber public key bytes. The fingerprint is the
// SHA-256 of the two leaves concatenated.
function computeIdentityMerkleRootRaw(input) {
	const signingLeaf = sha256(base64ToBytes(input.signingKey));
	const encryptionLeaf = sha256(hexToBytes(input.encryptionKey));
	return sha256(concatBytes(signingLeaf, encryptionLeaf));
}

export function computeIdentityFingerprint(input) {
	if (!input || typeof input !== "object") {
		throw new Error("publicIdentity is required");
	}
	const { signingKeyType, encryptionKeyType, signingKey, encryptionKey } = input;
	if (typeof signingKey !== "string" || !signingKey) {
		throw new Error("publicIdentity missing signingKey");
	}
	if (typeof encryptionKey !== "string" || !encryptionKey) {
		throw new Error("publicIdentity missing encryptionKey");
	}
	const root = computeIdentityMerkleRootRaw({
		signingKeyType,
		encryptionKeyType,
		signingKey,
		encryptionKey,
	});
	if (root.length !== FINGERPRINT_BYTE_LENGTH) {
		throw new Error("invalid fingerprint length");
	}
	const hrp = getFingerprintHrp(signingKeyType, encryptionKeyType);
	return bech32.encode(hrp, bech32.toWords(root));
}

export function isValidFingerprintBech32(fingerprint) {
	if (typeof fingerprint !== "string" || !fingerprint) return false;
	if (fingerprint !== fingerprint.toLowerCase()) return false;
	try {
		const decoded = bech32.decode(fingerprint);
		if (!FINGERPRINT_HRPS.includes(decoded.prefix)) return false;
		const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
		return bytes.length === FINGERPRINT_BYTE_LENGTH;
	} catch {
		return false;
	}
}

// Verify a signature attached to a message (or pre-hashed message) using
// the signer's public key. Returns true only if the signature passes.
//
// Encoding/API note: per `core/Dilithium.ts::verify` and
// `core/Sphincs.ts::verify`, the `signingKey` and `signature` strings are
// BASE64-encoded, not hex, and noble verifies as
// `verify(signature, message, publicKey)`.
export function verifySignature(publicIdentity, input) {
	if (!publicIdentity || typeof publicIdentity !== "object") {
		throw new Error("publicIdentity is required");
	}
	const { signingKey, signingKeyType } = publicIdentity;
	if (typeof signingKey !== "string" || typeof signingKeyType !== "string") {
		throw new Error("publicIdentity missing signingKey/signingKeyType");
	}
	if (typeof input.signature !== "string" || !input.signature) {
		throw new Error("signature is required");
	}

	const salt = input.salt ?? "";
	let messageHash = "";
	if (typeof input.message === "string") {
		messageHash = sha256Hex(input.message);
	} else if (typeof input.messageHash === "string" && input.messageHash.length > 0) {
		messageHash = input.messageHash;
	} else {
		throw new Error("either message or messageHash is required");
	}

	const signer = selectSigner(signingKeyType);
	const publicKeyBytes = base64ToBytes(signingKey);
	const signatureBytes = base64ToBytes(input.signature);
	const envelopes = [
		buildCurrentEnvelopeFromHash(messageHash, salt),
		buildLegacyEnvelopeFromHash(messageHash, salt),
	];
	for (const envelope of envelopes) {
		try {
			if (signer.verify(signatureBytes, encoder.encode(envelope), publicKeyBytes)) {
				return true;
			}
		} catch {
			// A malformed signature fails closed. The legacy envelope is still tried.
		}
	}
	return false;
}

export { sha256Hex };
