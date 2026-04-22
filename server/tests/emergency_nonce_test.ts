import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { Identity } from "../../core/Identity.ts";
import {
	EMERGENCY_NONCE_BASE,
	decodeRevocationCertificate,
} from "../../core/Revocation.ts";
import { computeStateHash } from "../../core/StateHash.ts";
import { buildMessageHashEnvelope } from "../../core/MessageHash.ts";
import { stableStringify } from "../../core/StateHash.ts";

type MainModule = typeof import("../main.ts");

async function withServer(fn: (mod: MainModule) => Promise<void>): Promise<void> {
	const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
	Deno.env.set("DB_PATH", dbPath);
	const mod: MainModule = await import(`../main.ts#${crypto.randomUUID()}`);
	try {
		await fn(mod);
	} finally {
		try { await mod.closeDb(); } catch { /* ignore */ }
		try { Deno.removeSync(dbPath); } catch { /* ignore */ }
		Deno.env.delete("DB_PATH");
	}
}

function buildIdentityRegistration(identity: Identity): Record<string, unknown> {
	const fingerprint = identity.toFingerprint();
	const toState = computeStateHash({
		fingerprint,
		signingKeyType: identity.signingKeyType,
		encryptionKeyType: identity.encryptionKeyType,
		signingKey: identity.signingKey.publicKey,
		encryptionKey: identity.encryptionKey.publicKey,
		signingKeyDetails: { variant: identity.signingKey.variant },
		encryptionKeyDetails: { variant: identity.encryptionKey.variant },
		details: {},
	});
	const transitionMessage = stableStringify({ fromState: null, toState });
	const stateSignature = identity.signingKey.sign(buildMessageHashEnvelope(transitionMessage));
	return {
		signingKeyType: identity.signingKeyType,
		encryptionKeyType: identity.encryptionKeyType,
		signingKey: identity.signingKey.publicKey,
		encryptionKey: identity.encryptionKey.publicKey,
		signingKeyDetails: { variant: identity.signingKey.variant },
		encryptionKeyDetails: { variant: identity.encryptionKey.variant },
		toState,
		fromState: null,
		stateSignature,
		fingerprint,
	};
}

Deno.test("F-CRYPTO-01: emergency cert uses EMERGENCY_NONCE_BASE", () => {
	const id = new Identity("dilithium", "kyber");
	const cert = id.generateEmergencyRevocationCertificate();
	const decoded = decodeRevocationCertificate(cert);
	assert(decoded !== null, "emergency cert must decode");
	assertEquals(decoded!.nonce, EMERGENCY_NONCE_BASE);
});

Deno.test("F-CRYPTO-01: server accepts emergency cert whose nonce is in the emergency range", async () => {
	await withServer(async (mod) => {
		const id = new Identity("dilithium", "kyber");
		const fingerprint = id.toFingerprint();
		const emergencyCert = id.generateEmergencyRevocationCertificate();

		const reg = await mod.handleRequest(
			new Request("http://localhost/api/v1/identity", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(buildIdentityRegistration(id)),
			}),
		);
		assertEquals(reg.status, 200);

		const post = await mod.handleRequest(
			new Request("http://localhost/api/v1/revoke", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					fingerprint,
					type: "identity",
					certificate: emergencyCert,
				}),
			}),
		);
		assertEquals(post.status, 200);
	});
});

Deno.test("F-CRYPTO-01: replayed emergency cert is rejected", async () => {
	await withServer(async (mod) => {
		const id = new Identity("dilithium", "kyber");
		const fingerprint = id.toFingerprint();
		const emergencyCert = id.generateEmergencyRevocationCertificate();

		await mod.handleRequest(
			new Request("http://localhost/api/v1/identity", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(buildIdentityRegistration(id)),
			}),
		);
		const a = await mod.handleRequest(
			new Request("http://localhost/api/v1/revoke", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ fingerprint, type: "identity", certificate: emergencyCert }),
			}),
		);
		assertEquals(a.status, 200);

		const b = await mod.handleRequest(
			new Request("http://localhost/api/v1/revoke", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ fingerprint, type: "identity", certificate: emergencyCert }),
			}),
		);
		assert(b.status === 400 || b.status === 409, `expected 400/409 got ${b.status}`);
	});
});
