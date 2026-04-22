// F-WEB-01: browser-side signature verification for the EBP website.
//
// Prior to this module the `website/verify.js` flow blindly trusted the
// server's `{"verified": true}` response, undermining EBP's "server is
// just a directory; trust is cryptographic" property. This module uses
// the same `@noble/post-quantum` primitives as `core/` to re-verify
// signatures client-side.
//
// Imports pull pinned-version browser ESM bundles from esm.sh. The site
// is static, so no build step is required.

import { ml_dsa87 } from "https://esm.sh/@noble/post-quantum@0.5.4/ml-dsa";
import { slh_dsa_sha2_256s } from "https://esm.sh/@noble/post-quantum@0.5.4/slh-dsa";
import { sha256 } from "https://esm.sh/@noble/hashes@1.8.0/sha2";

const encoder = new TextEncoder();

function bytesToHex(bytes) {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

function hexToBytes(hex) {
	if (typeof hex !== "string" || hex.length % 2 !== 0) {
		throw new Error("invalid hex");
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	}
	return out;
}

function sha256Hex(message) {
	return bytesToHex(sha256(encoder.encode(message)));
}

// Same envelope format as `core/MessageHash.ts::buildMessageHashEnvelope`.
function buildMessageHashEnvelope(message, salt) {
	return `ebp::messagehash::${sha256Hex(message)}::${salt ?? ""}`;
}

function buildMessageHashEnvelopeFromHash(messageHash, salt) {
	return `ebp::messagehash::${messageHash}::${salt ?? ""}`;
}

function selectSigner(signingKeyType) {
	if (signingKeyType === "dilithium") return ml_dsa87;
	if (signingKeyType === "sphincs") return slh_dsa_sha2_256s;
	throw new Error(`unsupported signing key type: ${signingKeyType}`);
}

// Verify a signature attached to a message (or pre-hashed message) using
// the signer's public key. Returns true only if the signature passes.
export function verifySignature(publicIdentity, input) {
	if (!publicIdentity || typeof publicIdentity !== "object") {
		throw new Error("publicIdentity is required");
	}
	const { signingKey, signingKeyType } = publicIdentity;
	if (typeof signingKey !== "string" || typeof signingKeyType !== "string") {
		throw new Error("publicIdentity missing signingKey/signingKeyType");
	}

	let envelopeBytes;
	if (typeof input.messageHash === "string" && input.messageHash.length > 0) {
		envelopeBytes = encoder.encode(buildMessageHashEnvelopeFromHash(input.messageHash, input.salt ?? ""));
	} else if (typeof input.message === "string") {
		envelopeBytes = encoder.encode(buildMessageHashEnvelope(input.message, input.salt ?? ""));
	} else {
		throw new Error("either message or messageHash is required");
	}

	const signer = selectSigner(signingKeyType);
	const publicKeyBytes = hexToBytes(signingKey);
	const signatureBytes = hexToBytes(input.signature);

	try {
		return signer.verify(publicKeyBytes, envelopeBytes, signatureBytes);
	} catch {
		return false;
	}
}

export { sha256Hex };
