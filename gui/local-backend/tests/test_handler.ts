/**
 * Test handler module that re-exports the request handler from main.ts
 * without starting the server. This is done by extracting the handler logic.
 */

import { Identity, ExternalIdentity, IdentityPublicData } from "../../../core/Identity.ts";
import { DilithiumSigningKey } from "../../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../../core/Sphincs.ts";
import { KyberEncryptionKey } from "../../../core/Kyber.ts";
import { PROTOCOL_VERSION, FILE_FORMAT_VERSIONS } from "../../../core/version.ts";
import {
	CLIContext,
	buildStateFromExternal,
	computeStateHash,
	getContext,
	listIdentityNames,
	readState,
	stableStringify,
	updateState,
	apiUrl,
	ensureDir,
} from "../../../cli/utils.ts";

type JsonValue = Record<string, unknown>;

const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "content-type",
	"access-control-allow-methods": "GET,POST,OPTIONS",
};

const STATUS = {
	OK: 200,
	Created: 201,
	BadRequest: 400,
	Unauthorized: 401,
	NotFound: 404,
	Conflict: 409,
	BadGateway: 502,
	InternalServerError: 500,
} as const;
type StatusCode = (typeof STATUS)[keyof typeof STATUS];

class HttpError extends Error {
	status: StatusCode;
	details?: unknown;

	constructor(status: StatusCode, message: string, details?: unknown) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

function json(body: unknown, status: StatusCode = STATUS.OK): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			...CORS_HEADERS,
		},
	});
}

async function readJson<T extends JsonValue>(req: Request): Promise<T> {
	try {
		return (await req.json()) as T;
	} catch {
		throw new HttpError(STATUS.BadRequest, "invalid json body");
	}
}

async function loadIdentity(ctx: CLIContext, password: string): Promise<Identity> {
	let storageData: string;
	try {
		storageData = await Deno.readTextFile(ctx.identityPath);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			throw new HttpError(STATUS.NotFound, "identity not found");
		}
		throw e;
	}

	let identity: Identity;
	try {
		identity = await Identity.fromStorageFormat(storageData, password);
	} catch {
		throw new HttpError(STATUS.Unauthorized, "failed to decrypt identity (wrong password?)");
	}

	return identity;
}

async function loadIdentityPublic(ctx: CLIContext): Promise<IdentityPublicData | null> {
	let storageData: string;
	try {
		storageData = await Deno.readTextFile(ctx.identityPath);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			return null;
		}
		throw e;
	}

	return Identity.readPublicData(storageData);
}

async function saveIdentity(ctx: CLIContext, password: string, identity: Identity): Promise<void> {
	const baseName = ctx.currentIdentity;
	const dir = ctx.identityDir;
	const newPath = `${dir}/${baseName}.identity.json`;

	const storageData = await identity.toStorageFormat(password);
	await Deno.writeTextFile(newPath, storageData);

	ctx.identityPath = newPath;
}

async function loadContact(ctx: CLIContext, nameOrFingerprint: string): Promise<ExternalIdentity> {
	const byName = `${ctx.contactsDir}/${nameOrFingerprint}.json`;
	try {
		const json = await Deno.readTextFile(byName);
		return JSON.parse(json) as ExternalIdentity;
	} catch {
		// Try fingerprint prefix search
		try {
			for await (const entry of Deno.readDir(ctx.contactsDir)) {
				if (entry.isFile && entry.name.endsWith(".json")) {
					const contactPath = `${ctx.contactsDir}/${entry.name}`;
					const json = await Deno.readTextFile(contactPath);
					const contact = JSON.parse(json) as ExternalIdentity;
					if (contact.fingerprint.startsWith(nameOrFingerprint)) {
						return contact;
					}
				}
			}
		} catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				throw new HttpError(STATUS.NotFound, "no contacts found");
			}
			throw e;
		}
	}

	throw new HttpError(STATUS.NotFound, "contact not found");
}

function resolveServer(ctx: CLIContext, override?: string): string {
	const server = override ?? ctx.server;
	if (!server) throw new HttpError(STATUS.BadRequest, "server not configured");
	return server.replace(/\/+$/, "");
}

async function listContacts(ctx: CLIContext): Promise<Array<{ name: string; contact: ExternalIdentity }>> {
	const contacts: Array<{ name: string; contact: ExternalIdentity }> = [];
	try {
		for await (const entry of Deno.readDir(ctx.contactsDir)) {
			if (!entry.isFile || !entry.name.endsWith(".json")) continue;
			const name = entry.name.replace(".json", "");
			const json = await Deno.readTextFile(`${ctx.contactsDir}/${entry.name}`);
			contacts.push({ name, contact: JSON.parse(json) as ExternalIdentity });
		}
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return contacts;
		throw e;
	}
	return contacts;
}

function computeExternalFingerprint(identity: ExternalIdentity): string | null {
	try {
		const shell = Object.create(Identity.prototype) as Identity;
		shell.signingKeyType = identity.signingKeyType;
		shell.encryptionKeyType = identity.encryptionKeyType;

		switch (identity.signingKeyType) {
			case "dilithium":
				shell.signingKey = DilithiumSigningKey.fromPublicKey(
					identity.signingKey,
					identity.signingKeyDetails?.variant ?? "ml_dsa87",
				);
				break;
			case "sphincs":
				shell.signingKey = SphincsSigningKey.fromPublicKey(
					identity.signingKey,
					identity.signingKeyDetails?.variant ?? "slh_dsa_sha2_256s",
				);
				break;
			default:
				return null;
		}

		switch (identity.encryptionKeyType) {
			case "kyber":
				shell.encryptionKey = KyberEncryptionKey.fromPublicKey(
					identity.encryptionKey,
					identity.encryptionKeyDetails?.variant ?? "ml_kem1024",
				);
				break;
			default:
				return null;
		}

		return shell.toFingerprint();
	} catch {
		return null;
	}
}

export async function handleRequestForTest(req: Request): Promise<Response> {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	try {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/api/v1/health") {
			return json({ ok: true, protocolVersion: PROTOCOL_VERSION });
		}

		if (req.method === "GET" && url.pathname === "/api/v1/context") {
			const home = url.searchParams.get("home") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const state = await readState(ctx.identityDir);
			return json({
				identityDir: ctx.identityDir,
				contactsDir: ctx.contactsDir,
				currentIdentity: ctx.currentIdentity,
				server: state?.server ?? null,
				protocolVersion: PROTOCOL_VERSION,
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/identities") {
			const home = url.searchParams.get("home") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const names = await listIdentityNames(ctx.identityDir);
			const currentState = await readState(ctx.identityDir);

			const identitiesWithFingerprints = await Promise.all(
				names.map(async (name) => {
					const identityCtx = await getContext(home ?? undefined, name);
					const publicData = await loadIdentityPublic(identityCtx);
					const fingerprint = publicData?.fingerprint ?? null;
					return { name, fingerprint, publishedToServer: false };
				})
			);

			return json({
				identities: identitiesWithFingerprints,
				currentIdentity: currentState?.currentIdentity ?? ctx.currentIdentity,
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/identity/public") {
			const home = url.searchParams.get("home") ?? undefined;
			const identityName = url.searchParams.get("identity") ?? undefined;
			const ctx = await getContext(home ?? undefined, identityName);
			const publicData = await loadIdentityPublic(ctx);
			if (!publicData) {
				return json({ available: false });
			}
			const detailsArray = Object.entries(publicData.details ?? {}).map(([path, val]) => ({
				path,
				detail: Array.isArray(val) ? val[0] : val,
			}));
			// Get revoked details
			const revokedDetailPaths = Object.keys(publicData.revokedDetails ?? {});
			return json({
				available: true,
				fingerprint: publicData.fingerprint,
				signingKeyType: publicData.signingKeyType,
				encryptionKeyType: publicData.encryptionKeyType,
				signingKeyDetails: publicData.signingKeyDetails,
				encryptionKeyDetails: publicData.encryptionKeyDetails,
				details: detailsArray,
				revoked: !!publicData.revocationCertificate,
				revokedDetails: revokedDetailPaths,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/identity/generate") {
			const body = await readJson<{
				name?: unknown;
				signingType?: unknown;
				encryptionType?: unknown;
				password?: unknown;
				force?: unknown;
				home?: unknown;
			}>(req);

			const name = typeof body.name === "string" && body.name.length > 0 ? body.name : undefined;
			const signingType = typeof body.signingType === "string" ? body.signingType : "dilithium";
			const encryptionType = typeof body.encryptionType === "string" ? body.encryptionType : "kyber";
			const password = typeof body.password === "string" ? body.password : undefined;
			const force = Boolean(body.force);
			const home = typeof body.home === "string" ? body.home : undefined;

			const ctx = await getContext(home, name);

			if (!password || password.length < 8) {
				throw new HttpError(STATUS.BadRequest, "password required and must be at least 8 characters");
			}

			if (!["dilithium", "sphincs"].includes(signingType)) {
				throw new HttpError(STATUS.BadRequest, "invalid signing type (dilithium|sphincs)");
			}
			if (encryptionType !== "kyber") {
				throw new HttpError(STATUS.BadRequest, "invalid encryption type (only kyber supported)");
			}

			try {
				await Deno.stat(ctx.identityPath);
				if (!force) {
					throw new HttpError(STATUS.Conflict, "identity already exists; pass force to overwrite");
				}
			} catch (e) {
				if (!(e instanceof Deno.errors.NotFound)) throw e;
			}

			const identity = new Identity(signingType as "dilithium" | "sphincs", encryptionType as "kyber");

			await ensureDir(ctx.identityDir);
			await ensureDir(ctx.contactsDir);
			await saveIdentity(ctx, password, identity);
			await updateState(ctx.identityDir, { currentIdentity: ctx.currentIdentity });

			return json(
				{
					ok: true,
					identity: {
						name: ctx.currentIdentity,
						fingerprint: identity.toFingerprint(),
						signingKeyType: identity.signingKeyType,
						encryptionKeyType: identity.encryptionKeyType,
						identityPath: ctx.identityPath,
					},
				},
				STATUS.Created
			);
		}

		if (req.method === "POST" && url.pathname === "/api/v1/identity/use") {
			const body = await readJson<{ name?: unknown; home?: unknown }>(req);
			const name = typeof body.name === "string" ? body.name : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			if (!name) throw new HttpError(STATUS.BadRequest, "name is required");

			const ctx = await getContext(home, name);
			try {
				await Deno.stat(ctx.identityPath);
			} catch (e) {
				if (e instanceof Deno.errors.NotFound) {
					throw new HttpError(STATUS.NotFound, "identity not found");
				}
				throw e;
			}

			await updateState(ctx.identityDir, { currentIdentity: name });
			return json({ ok: true, currentIdentity: name });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/identity/info") {
			const body = await readJson<{ password?: unknown; home?: unknown; identity?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			return json({
				fingerprint: identity.toFingerprint(),
				signingKeyType: identity.signingKeyType,
				encryptionKeyType: identity.encryptionKeyType,
				details: Array.from(identity.details.entries()).map(([path, [detail]]) => ({ path, detail })),
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/identity/export-public") {
			const body = await readJson<{ password?: unknown; home?: unknown; identity?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			return json(identity.summary);
		}

		if (req.method === "GET" && url.pathname === "/api/v1/contacts") {
			const home = url.searchParams.get("home") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const contacts = await listContacts(ctx);
			return json({
				contacts: contacts.map(({ name, contact }) => ({
					name,
					fingerprint: contact.fingerprint,
					signingKeyType: contact.signingKeyType,
					encryptionKeyType: contact.encryptionKeyType,
					details: contact.details ?? {},
				})),
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/contacts/import") {
			const body = await readJson<{ contact?: unknown; name?: unknown; home?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const contact = body.contact as ExternalIdentity | undefined;
			const name = typeof body.name === "string" ? body.name : undefined;
			if (!contact) throw new HttpError(STATUS.BadRequest, "contact payload is required");
			if (!contact.fingerprint || !contact.signingKey || !contact.encryptionKey) {
				throw new HttpError(STATUS.BadRequest, "contact missing required fields");
			}

			const ctx = await getContext(home);
			await ensureDir(ctx.contactsDir);
			const contactName = name ?? contact.fingerprint.substring(0, 16);
			const contactPath = `${ctx.contactsDir}/${contactName}.json`;
			await Deno.writeTextFile(contactPath, JSON.stringify(contact, null, 2));

			return json({ ok: true, name: contactName, fingerprint: contact.fingerprint });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/sign") {
			const body = await readJson<{
				message?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				detached?: unknown;
				includeIdentity?: unknown;
			}>(req);
			const message = typeof body.message === "string" ? body.message : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const detached = Boolean(body.detached);
			const includeIdentity = Boolean(body.includeIdentity);
			if (!message) throw new HttpError(STATUS.BadRequest, "message is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			const signature = identity.signMessage(message);
			const summary = identity.summary;
			const identityPayload = includeIdentity
				? {
					fingerprint: summary.fingerprint,
					signingKeyType: summary.signingKeyType,
					encryptionKeyType: summary.encryptionKeyType,
					signingKey: summary.signingKey,
					encryptionKey: summary.encryptionKey,
					signingKeyDetails: summary.signingKeyDetails,
					encryptionKeyDetails: summary.encryptionKeyDetails,
				}
				: undefined;
			if (detached) {
				return json({
					type: "ebp-signature",
					version: FILE_FORMAT_VERSIONS.signature,
					fingerprint: identity.toFingerprint(),
					signature,
					identity: identityPayload,
				});
			}
			return json({
				type: "ebp-signed-message",
				version: FILE_FORMAT_VERSIONS.signedMessage,
				fingerprint: identity.toFingerprint(),
				message,
				signature,
				identity: identityPayload,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/verify") {
			const body = await readJson<{
				payload?: unknown;
				message?: unknown;
				signature?: unknown;
				sender?: unknown;
				home?: unknown;
				publicIdentity?: unknown;
			}>(req);
			const payload = body.payload;
			const messageOverride = typeof body.message === "string" ? body.message : undefined;
			const signatureOverride = typeof body.signature === "string" ? body.signature : undefined;
			const sender = typeof body.sender === "string" ? body.sender : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const publicIdentity = body.publicIdentity;
			if (!payload) throw new HttpError(STATUS.BadRequest, "payload is required");

			const ctx = await getContext(home);
			let message: string;
			let signature: string;
			let fingerprint: string;

			if (typeof payload === "object" && payload && "type" in payload) {
				const obj = payload as Record<string, unknown>;
				if (obj.type === "ebp-signed-message") {
					message = String(obj.message ?? "");
					signature = String(obj.signature ?? "");
					fingerprint = String(obj.fingerprint ?? "");
				} else if (obj.type === "ebp-signature") {
					if (!messageOverride) {
						throw new HttpError(STATUS.BadRequest, "message is required for detached signatures");
					}
					message = messageOverride;
					signature = String(obj.signature ?? "");
					fingerprint = String(obj.fingerprint ?? "");
				} else {
					throw new HttpError(STATUS.BadRequest, "unsupported payload type");
				}
			} else {
				if (!messageOverride || !signatureOverride) {
					throw new HttpError(STATUS.BadRequest, "message and signature required for detached verify");
				}
				message = messageOverride;
				signature = signatureOverride;
				fingerprint = "";
			}

			let contact: ExternalIdentity;
			if (publicIdentity && typeof publicIdentity === "object") {
				const candidate = publicIdentity as Record<string, unknown>;
				const signingKey = typeof candidate.signingKey === "string" ? candidate.signingKey : "";
				const signingKeyType = typeof candidate.signingKeyType === "string" ? candidate.signingKeyType : "";
				const encryptionKey = typeof candidate.encryptionKey === "string" ? candidate.encryptionKey : "";
				const encryptionKeyType = typeof candidate.encryptionKeyType === "string" ? candidate.encryptionKeyType : "";
				if (!signingKey || !signingKeyType) {
					throw new HttpError(STATUS.BadRequest, "public identity missing signing key");
				}
				if (!encryptionKey || !encryptionKeyType) {
					throw new HttpError(STATUS.BadRequest, "public identity missing encryption key");
				}
				if (!["dilithium", "sphincs"].includes(signingKeyType)) {
					throw new HttpError(STATUS.BadRequest, "public identity has invalid signing key type");
				}
				if (encryptionKeyType !== "kyber") {
					throw new HttpError(STATUS.BadRequest, "public identity has invalid encryption key type");
				}
				contact = {
					fingerprint: typeof candidate.fingerprint === "string" ? candidate.fingerprint : fingerprint,
					signingKey,
					signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
					signingKeyDetails: candidate.signingKeyDetails,
					encryptionKey,
					encryptionKeyType: "kyber",
					encryptionKeyDetails: candidate.encryptionKeyDetails,
					details: (candidate.details as ExternalIdentity["details"]) ?? {},
				};
			} else {
				contact = await loadContact(ctx, sender ?? fingerprint.substring(0, 16));
			}
			const verified = Identity.VerifySignature(contact, message, signature);
			return json({ verified });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/encrypt") {
			const body = await readJson<{
				message?: unknown;
				recipient?: unknown;
				sign?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const message = typeof body.message === "string" ? body.message : undefined;
			const recipient = typeof body.recipient === "string" ? body.recipient : undefined;
			const sign = Boolean(body.sign);
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			if (!message) throw new HttpError(STATUS.BadRequest, "message is required");
			if (!recipient) throw new HttpError(STATUS.BadRequest, "recipient is required");

			const ctx = await getContext(home, identityName);
			const contact = await loadContact(ctx, recipient);

			if (sign) {
				if (!password) throw new HttpError(STATUS.BadRequest, "password is required when signing");
				const identity = await loadIdentity(ctx, password);
				const ciphertext = identity.signAndEncryptFor(message, contact);
				return json({
					type: "ebp-encrypted-signed-message",
					version: FILE_FORMAT_VERSIONS.encryptedSignedMessage,
					recipientFingerprint: contact.fingerprint,
					senderFingerprint: identity.toFingerprint(),
					ciphertext,
				});
			}

			const ciphertext = Identity.EncryptFor(contact, message);
			return json({
				type: "ebp-encrypted-message",
				version: FILE_FORMAT_VERSIONS.encryptedMessage,
				recipientFingerprint: contact.fingerprint,
				ciphertext,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/decrypt") {
			const body = await readJson<{
				payload?: unknown;
				password?: unknown;
				sender?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const payload = body.payload as Record<string, unknown> | undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const sender = typeof body.sender === "string" ? body.sender : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			if (!payload) throw new HttpError(STATUS.BadRequest, "payload is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);

			const type = payload.type;
			if (type === "ebp-encrypted-message") {
				const ciphertext = String(payload.ciphertext ?? "");
				let message: string;
				try {
					message = identity.encryptionKey.decrypt(ciphertext);
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
				}
				return json({ message, verified: null, verifyStatus: "unsigned", signerFingerprint: null });
			}

			if (type === "ebp-encrypted-signed-message") {
				const ciphertext = String(payload.ciphertext ?? "");
				const senderFp = typeof payload.senderFingerprint === "string" ? payload.senderFingerprint : undefined;
				let contact: ExternalIdentity | undefined;
				let isKnownContact = false;
				let signerFingerprint: string | null = senderFp ?? null;

				const safeDecrypt = (ct: string): string => {
					try {
						return identity.encryptionKey.decrypt(ct);
					} catch {
						throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
					}
				};

				if (sender) {
					try {
						contact = await loadContact(ctx, sender);
						isKnownContact = true;
					} catch {
						if (senderFp) {
							// Sender not found locally
						}
						if (!contact) {
							const message = safeDecrypt(ciphertext);
							try {
								const inner = JSON.parse(message);
								return json({
									message: inner.message ?? message,
									verified: null,
									verifyStatus: "sender_not_found",
									signerFingerprint,
								});
							} catch {
								return json({ message, verified: null, verifyStatus: "sender_not_found", signerFingerprint });
							}
						}
					}
				} else if (senderFp) {
					try {
						contact = await loadContact(ctx, senderFp.substring(0, 16));
						isKnownContact = true;
					} catch {
						const message = safeDecrypt(ciphertext);
						try {
							const inner = JSON.parse(message);
							return json({
								message: inner.message ?? message,
								verified: null,
								verifyStatus: "sender_not_in_contacts",
								signerFingerprint,
							});
						} catch {
							return json({ message, verified: null, verifyStatus: "sender_not_in_contacts", signerFingerprint });
						}
					}
				} else {
					const message = safeDecrypt(ciphertext);
					try {
						const inner = JSON.parse(message);
						return json({
							message: inner.message ?? message,
							verified: null,
							verifyStatus: "sender_not_specified",
							signerFingerprint,
						});
					} catch {
						return json({ message, verified: null, verifyStatus: "sender_not_specified", signerFingerprint });
					}
				}

				try {
					const computedFingerprint = computeExternalFingerprint(contact);
					signerFingerprint = contact.fingerprint ?? signerFingerprint;
					if (!computedFingerprint || computedFingerprint !== contact.fingerprint) {
						const message = safeDecrypt(ciphertext);
						try {
							const inner = JSON.parse(message);
							return json({
								message: inner.message ?? message,
								verified: false,
								verifyStatus: "fingerprint_mismatch",
								signerFingerprint,
							});
						} catch {
							return json({ message, verified: false, verifyStatus: "fingerprint_mismatch", signerFingerprint });
						}
					}
					if (senderFp && computedFingerprint !== senderFp) {
						const message = safeDecrypt(ciphertext);
						try {
							const inner = JSON.parse(message);
							return json({
								message: inner.message ?? message,
								verified: false,
								verifyStatus: "fingerprint_mismatch",
								signerFingerprint,
							});
						} catch {
							return json({ message, verified: false, verifyStatus: "fingerprint_mismatch", signerFingerprint });
						}
					}
					const result = identity.decryptAndVerify(ciphertext, contact);
					if (result.verified) {
						const status = isKnownContact ? "valid" : "valid_unknown_signer";
						return json({
							message: result.message,
							verified: result.verified,
							verifyStatus: status,
							signerFingerprint,
						});
					} else {
						return json({
							message: result.message,
							verified: false,
							verifyStatus: "invalid",
							signerFingerprint,
						});
					}
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
				}
			}

			throw new HttpError(STATUS.BadRequest, "unsupported payload type");
		}

		if (req.method === "POST" && url.pathname === "/api/v1/detail") {
			const body = await readJson<{
				path?: unknown;
				detail?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				push?: unknown;
				server?: unknown;
			}>(req);
			const path = typeof body.path === "string" ? body.path : undefined;
			const detail = typeof body.detail === "string" ? body.detail : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			if (!path || !detail) throw new HttpError(STATUS.BadRequest, "path and detail are required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			identity.attachDetail(path, detail);
			await saveIdentity(ctx, password, identity);

			return json({ ok: true, path, detail });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/verify-email/request") {
			return json({ ok: true, status: "sent" });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/revoke/detail") {
			const body = await readJson<{
				path?: unknown;
				reason?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const path = typeof body.path === "string" ? body.path : undefined;
			const reason = typeof body.reason === "string" ? body.reason : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			if (!path) throw new HttpError(STATUS.BadRequest, "path is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			
			if (!identity.details.has(path)) {
				throw new HttpError(STATUS.NotFound, "detail not found");
			}

			identity.revokeDetail(path, reason);
			await saveIdentity(ctx, password, identity);

			return json({ ok: true, path, revoked: true });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/revoke/identity") {
			const body = await readJson<{
				reason?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const reason = typeof body.reason === "string" ? body.reason : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			
			if (identity.isRevoked()) {
				throw new HttpError(STATUS.Conflict, "identity is already revoked");
			}

			identity.createIdentityRevocation(reason);
			await saveIdentity(ctx, password, identity);

			return json({ ok: true, revoked: true, fingerprint: identity.toFingerprint() });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/revoke/emergency-cert") {
			const body = await readJson<{
				password?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;

			if (!password) {
				throw new HttpError(STATUS.BadRequest, "password required");
			}

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);

			const emergencyCert = identity.generateEmergencyRevocationCertificate();
			
			return json({
				type: "ebp-emergency-revocation-certificate",
				version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
				fingerprint: identity.toFingerprint(),
				certificate: emergencyCert,
				createdAt: new Date().toISOString(),
				warning: "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/server") {
			const home = url.searchParams.get("home") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const state = await readState(ctx.identityDir);
			return json({ server: state?.server ?? null });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/server") {
			const body = await readJson<{ url?: unknown; clear?: unknown; home?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const urlValue = typeof body.url === "string" ? body.url : undefined;
			const clear = Boolean(body.clear);
			const ctx = await getContext(home);

			if (clear) {
				const state = await updateState(ctx.identityDir, { server: undefined });
				return json({ ok: true, server: state.server ?? null });
			}

			if (!urlValue) throw new HttpError(STATUS.BadRequest, "url is required");
			const state = await updateState(ctx.identityDir, { server: urlValue });
			return json({ ok: true, server: state.server ?? null });
		}

		if (req.method === "GET" && url.pathname === "/api/v1/server/identities") {
			const home = url.searchParams.get("home") ?? undefined;
			const serverOverride = url.searchParams.get("server") ?? undefined;
			const page = url.searchParams.get("page") ?? undefined;
			const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			
			const server = serverOverride ?? ctx.server;
			if (!server) throw new HttpError(STATUS.BadRequest, "server not configured");
			const cleanServer = server.replace(/\/+$/, "");

			const path = query ? "/api/v1/identities/search" : "/api/v1/identities";
			const serverUrl = new URL(`${cleanServer}${path}`);
			if (page) serverUrl.searchParams.set("page", page);
			if (query) serverUrl.searchParams.set("query", query);

			const res = await fetch(serverUrl.toString());
			let bodyJson: unknown = {};
			try {
				bodyJson = await res.json();
			} catch {
				// ignore
			}

			if (!res.ok) {
				const reason = (bodyJson as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
				throw new HttpError(STATUS.BadGateway, `failed to list server identities: ${reason}`);
			}

			const entriesRaw = (bodyJson as { identities?: unknown[] } | undefined)?.identities;
			if (!Array.isArray(entriesRaw)) {
				throw new HttpError(STATUS.BadGateway, "invalid response from server");
			}

			const entries = entriesRaw
				.map((v) => {
					if (!v || typeof v !== "object") return undefined;
					const obj = v as Record<string, unknown>;
					const fingerprint = typeof obj.fingerprint === "string" ? obj.fingerprint : undefined;
					if (!fingerprint) return undefined;
					const signingKeyType = typeof obj.signingKeyType === "string" ? obj.signingKeyType : undefined;
					const encryptionKeyType = typeof obj.encryptionKeyType === "string" ? obj.encryptionKeyType : undefined;
					const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : undefined;
					const details = typeof obj.details === "object" && obj.details ? obj.details as Record<string, [string, string] | string> : {};
					return { fingerprint, signingKeyType, encryptionKeyType, createdAt, details };
				})
				.filter((v): v is NonNullable<typeof v> => !!v);

			// Pass through pagination info from server
			const pagination = (bodyJson as { pagination?: unknown } | undefined)?.pagination;

			return json({ identities: entries, pagination });
		}

		return json({ error: "not found" }, STATUS.NotFound);
	} catch (err) {
		if (err instanceof HttpError) {
			return json({ error: err.message, details: err.details ?? undefined }, err.status);
		}
		console.error(err);
		return json({ error: "internal server error" }, STATUS.InternalServerError);
	}
}

