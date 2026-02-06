#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { serve } from "std/http/server";
import { Identity, ExternalIdentity, IdentityPublicData } from "../../core/Identity.ts";
import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";
import { KyberEncryptionKey } from "../../core/Kyber.ts";
import { PROTOCOL_VERSION } from "../../core/version.ts";
import {
	CLIContext,
	buildStateFromExternal,
	computeStateHash,
	getContext,
	listIdentityNames,
	getIdentityPath,
	readState,
	stableStringify,
	updateState,
	apiUrl,
	ensureDir,
} from "../../cli/utils.ts";

type JsonValue = Record<string, unknown>;

const STATIC_ROOT = new URL("..", import.meta.url);
const PORT = Number(Deno.env.get("GUI_BACKEND_PORT") ?? "8787");
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

function contentType(pathname: string): string {
	const lower = pathname.toLowerCase();
	if (lower.endsWith(".html")) return "text/html; charset=utf-8";
	if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
	if (lower.endsWith(".css")) return "text/css; charset=utf-8";
	if (lower.endsWith(".json")) return "application/json; charset=utf-8";
	if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}

async function tryServeStatic(req: Request, url: URL): Promise<Response | null> {
	if (req.method !== "GET" && req.method !== "HEAD") return null;
	if (url.pathname.startsWith("/api/")) return null;

	const decoded = decodeURIComponent(url.pathname);
	if (decoded.includes("..") || decoded.includes("\\")) {
		return new Response("Not found", { status: STATUS.NotFound, headers: CORS_HEADERS });
	}

	let target = decoded.replace(/^\/+/, "");
	if (target === "") target = "index.html";

	const fileUrl = new URL(target, STATIC_ROOT);
	let data: Uint8Array;
	try {
		data = await Deno.readFile(fileUrl);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return null;
		throw e;
	}

	const headers = {
		"content-type": contentType(target),
		...CORS_HEADERS,
	};
	if (req.method === "HEAD") {
		return new Response(null, { status: STATUS.OK, headers });
	}
	const copy = new Uint8Array(data.byteLength);
	copy.set(data);
	return new Response(copy.buffer, { status: STATUS.OK, headers });
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

/** Load only the public portion of an identity (no password required) */
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
	// Determine identity path
	const baseName = ctx.currentIdentity;
	const dir = ctx.identityDir;
	const newPath = `${dir}/${baseName}.identity.json`;
	
	// Save in new format
	const storageData = await identity.toStorageFormat(password);
	await Deno.writeTextFile(newPath, storageData);
	console.log(`Saved identity to ${newPath}`);
	
	// Update context path to new format for future operations
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

async function handleRequest(req: Request): Promise<Response> {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	try {
		const url = new URL(req.url);
		const staticResponse = await tryServeStatic(req, url);
		if (staticResponse) return staticResponse;

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
			const server = currentState?.server ?? null;
			
			// Load fingerprints for each identity and check server status
			const identitiesWithFingerprints = await Promise.all(
				names.map(async (name) => {
					const identityCtx = await getContext(home ?? undefined, name);
					const publicData = await loadIdentityPublic(identityCtx);
					const fingerprint = publicData?.fingerprint ?? null;
					
					// Check if published to server
					let publishedToServer = false;
					if (fingerprint && server) {
						try {
							const res = await fetch(apiUrl(server, `/api/v1/identity/${fingerprint}`));
							publishedToServer = res.ok;
						} catch {
							// Server unreachable, assume not published
						}
					}
					
					return {
						name,
						fingerprint,
						publishedToServer,
					};
				})
			);
			
			return json({
				identities: identitiesWithFingerprints,
				currentIdentity: currentState?.currentIdentity ?? ctx.currentIdentity,
			});
		}

		// Get public info for current identity (no password required)
		if (req.method === "GET" && url.pathname === "/api/v1/identity/public") {
			const home = url.searchParams.get("home") ?? undefined;
			const identityName = url.searchParams.get("identity") ?? undefined;
			const ctx = await getContext(home ?? undefined, identityName);
			const publicData = await loadIdentityPublic(ctx);
			if (!publicData) {
				return json({ available: false });
			}
			// Convert details from {path: [detail, proof]} to [{path, detail}]
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

			// Validate existence
			try {
				await Deno.stat(ctx.identityPath);
				if (!force) {
					throw new HttpError(STATUS.Conflict, "identity already exists; pass force to overwrite");
				}
			} catch (e) {
				if (!(e instanceof Deno.errors.NotFound)) throw e;
			}

			const identity = new Identity(
				signingType as "dilithium" | "sphincs",
				encryptionType as "kyber",
			);

			await ensureDir(ctx.identityDir);
			await ensureDir(ctx.contactsDir);
			await saveIdentity(ctx, password, identity);
			await updateState(ctx.identityDir, { currentIdentity: ctx.currentIdentity });

			return json({
				ok: true,
				identity: {
					name: ctx.currentIdentity,
					fingerprint: identity.toFingerprint(),
					signingKeyType: identity.signingKeyType,
					encryptionKeyType: identity.encryptionKeyType,
					identityPath: ctx.identityPath,
				},
			}, STATUS.Created);
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
					detailsMeta: contact.detailsMeta ?? {},
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
			}>(req);
			const message = typeof body.message === "string" ? body.message : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const detached = Boolean(body.detached);
			if (!message) throw new HttpError(STATUS.BadRequest, "message is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			const signature = identity.signMessage(message);
			if (detached) {
				return json({
					type: "ebp-signature",
					version: 1,
					fingerprint: identity.toFingerprint(),
					signature,
				});
			}
			return json({
				type: "ebp-signed-message",
				version: 1,
				fingerprint: identity.toFingerprint(),
				message,
				signature,
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
					revoked: false,
					revokedDetails: [],
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
					version: 1,
					recipientFingerprint: contact.fingerprint,
					senderFingerprint: identity.toFingerprint(),
					ciphertext,
				});
			}

			const ciphertext = Identity.EncryptFor(contact, message);
			return json({
				type: "ebp-encrypted-message",
				version: 1,
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
				// Unsigned message - return null for verified with reason
				const ciphertext = String(payload.ciphertext ?? "");
				let message: string;
				try {
					message = identity.encryptionKey.decrypt(ciphertext);
				} catch (e) {
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
				
				// Helper to safely decrypt
				const safeDecrypt = (ct: string): string => {
					try {
						return identity.encryptionKey.decrypt(ct);
					} catch {
						throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
					}
				};
				
				// Helper to try fetching identity from server
				const tryFetchFromServer = async (fingerprint: string): Promise<ExternalIdentity | null> => {
					if (!ctx.server) return null;
					try {
						const res = await fetch(apiUrl(ctx.server, `/api/v1/identity/${fingerprint}`));
						if (!res.ok) return null;
						const data = await res.json();
						if (!data.signingKey || !data.encryptionKey) return null;
						return {
							fingerprint: data.fingerprint ?? fingerprint,
							signingKeyType: data.signingKeyType === "sphincs" ? "sphincs" : "dilithium",
							encryptionKeyType: "kyber",
							signingKey: data.signingKey,
							encryptionKey: data.encryptionKey,
							signingKeyDetails: data.signingKeyDetails,
							encryptionKeyDetails: data.encryptionKeyDetails,
							details: data.details ?? {},
						};
					} catch {
						return null;
					}
				};
				
				// Try to find the sender contact
				if (sender) {
					try {
						contact = await loadContact(ctx, sender);
						isKnownContact = true;
					} catch {
						// Sender specified but not found in contacts - try server
						if (senderFp) {
							contact = await tryFetchFromServer(senderFp) ?? undefined;
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
						// Sender fingerprint in message but not in contacts - try server
						contact = await tryFetchFromServer(senderFp) ?? undefined;
						if (!contact) {
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
					}
				} else {
					// No sender specified at all
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
						// Signature is valid - but is this a known contact?
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
				} catch (e) {
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
			const push = Boolean(body.push);
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			if (!path || !detail) throw new HttpError(STATUS.BadRequest, "path and detail are required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			identity.attachDetail(path, detail);
			await saveIdentity(ctx, password, identity);

			if (push) {
				const server = resolveServer(ctx, serverOverride);
				const entry = identity.details.get(path);
				if (!entry) throw new HttpError(STATUS.InternalServerError, "failed to locate attached detail");
				const [detailValue, proof] = entry;

				const res = await fetch(apiUrl(server, "/api/v1/detail"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						fingerprint: identity.toFingerprint(),
						path,
						detail: detailValue,
						proof,
					}),
				});

				if (!res.ok) {
					let reason = `HTTP ${res.status}`;
					try {
						const body = await res.json();
						if (body?.error) reason = body.error;
					} catch {
						// ignore
					}
					throw new HttpError(STATUS.BadGateway, `failed to push detail: ${reason}`);
				}
			}

			return json({ ok: true, path, detail });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/verify-email/request") {
			const body = await readJson<{
				home?: unknown;
				identity?: unknown;
				server?: unknown;
				fingerprint?: unknown;
				detail?: unknown;
			}>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			const providedFingerprint = typeof body.fingerprint === "string" ? body.fingerprint : undefined;
			const detail = typeof body.detail === "string" ? body.detail : undefined;

			const ctx = await getContext(home, identityName);
			const server = resolveServer(ctx, serverOverride);
			const publicData = await loadIdentityPublic(ctx);
			const fingerprint = providedFingerprint ?? publicData?.fingerprint ?? null;
			if (!fingerprint) throw new HttpError(STATUS.NotFound, "identity fingerprint not found");

			const res = await fetch(apiUrl(server, "/api/v1/verify-email/request"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					fingerprint,
					detail,
				}),
			});

			if (!res.ok) {
				let reason = `HTTP ${res.status}`;
				try {
					const body = await res.json();
					if (body?.error) reason = body.error;
				} catch {
					// ignore
				}
				throw new HttpError(STATUS.BadGateway, `failed to send verification email: ${reason}`);
			}

			const payload = await res.json();
			return json(payload);
		}

		if (req.method === "POST" && url.pathname === "/api/v1/publish") {
			const body = await readJson<{
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				server?: unknown;
			}>(req);
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const server = resolveServer(ctx, serverOverride);
			const identity = await loadIdentity(ctx, password);
			const summary = identity.summary;

			let serverIdentity: ExternalIdentity | null = null;
			try {
				const res = await fetch(apiUrl(server, `/api/v1/identity/${summary.fingerprint}`));
				if (res.ok) {
					const body = await res.json();
					serverIdentity = {
						fingerprint: body.fingerprint,
						signingKeyType: body.signingKeyType,
						encryptionKeyType: body.encryptionKeyType,
						signingKey: body.signingKey,
						encryptionKey: body.encryptionKey,
						signingKeyDetails: body.signingKeyDetails,
						encryptionKeyDetails: body.encryptionKeyDetails,
						details: body.details ?? {},
					};
				} else if (res.status !== 404) {
					const body = await res.json().catch(() => ({}));
					const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
					throw new HttpError(STATUS.BadGateway, `failed to query server identity: ${reason}`);
				}
			} catch (e) {
				if (e instanceof HttpError) throw e;
				throw new HttpError(STATUS.BadGateway, `failed to query server identity: ${e instanceof Error ? e.message : String(e)}`);
			}

			if (serverIdentity) {
				if (
					serverIdentity.signingKey !== summary.signingKey ||
					serverIdentity.encryptionKey !== summary.encryptionKey ||
					serverIdentity.signingKeyType !== summary.signingKeyType ||
					serverIdentity.encryptionKeyType !== summary.encryptionKeyType
				) {
					throw new HttpError(STATUS.Conflict, "server identity keys differ from local identity");
				}
			}

			const serverDetails: Record<string, [string, string]> = serverIdentity?.details ?? {};
			const serverState = serverIdentity ? buildStateFromExternal(serverIdentity, serverDetails) : null;
			const fromState = serverState ? computeStateHash(serverState) : null;

			const nextState = buildStateFromExternal(
				{
					...summary,
					details: serverDetails,
				},
				serverDetails,
			);
			const toState = computeStateHash(nextState);
			const transitionMessage = stableStringify({ fromState, toState });
			const stateSignature = identity.signMessage(transitionMessage);

			const payload = {
				signingKeyType: summary.signingKeyType,
				encryptionKeyType: summary.encryptionKeyType,
				signingKey: summary.signingKey,
				encryptionKey: summary.encryptionKey,
				signingKeyDetails: summary.signingKeyDetails,
				encryptionKeyDetails: summary.encryptionKeyDetails,
				fingerprint: summary.fingerprint,
				fromState,
				toState,
				stateSignature,
			};

			const res = await fetch(apiUrl(server, "/api/v1/identity"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				let reason = `HTTP ${res.status}`;
				try {
					const body = await res.json();
					if (body?.error) reason = body.error;
				} catch {
					// ignore
				}
				throw new HttpError(STATUS.BadGateway, `failed to publish identity: ${reason}`);
			}

			return json({ ok: true, fingerprint: summary.fingerprint });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/fetch") {
			const body = await readJson<{
				fingerprint?: unknown;
				name?: unknown;
				home?: unknown;
				server?: unknown;
			}>(req);
			const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : undefined;
			const name = typeof body.name === "string" ? body.name : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			if (!fingerprint) throw new HttpError(STATUS.BadRequest, "fingerprint is required");

			const ctx = await getContext(home);
			const server = resolveServer(ctx, serverOverride);
			const res = await fetch(apiUrl(server, `/api/v1/identity/${fingerprint}`));
			let bodyJson: unknown = {};
			try {
				bodyJson = await res.json();
			} catch {
				// ignore
			}

			if (!res.ok) {
				const reason = (bodyJson as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
				throw new HttpError(STATUS.BadGateway, `failed to fetch identity: ${reason}`);
			}

			const b = bodyJson as {
				fingerprint?: string;
				signingKeyType?: string;
				encryptionKeyType?: string;
				signingKey?: string;
				encryptionKey?: string;
				signingKeyDetails?: unknown;
				encryptionKeyDetails?: unknown;
				details?: Record<string, [string, string]>;
				detailsMeta?: Record<string, { verified: boolean; verifiedAt: number | null }>;
			};

			const signingKeyType = b?.signingKeyType === "sphincs" ? "sphincs" as const : "dilithium" as const;
			const encryptionKeyType = "kyber" as const;

			const external: ExternalIdentity = {
				fingerprint: b?.fingerprint ?? fingerprint,
				signingKeyType,
				encryptionKeyType,
				signingKey: b?.signingKey ?? "",
				encryptionKey: b?.encryptionKey ?? "",
				signingKeyDetails: b?.signingKeyDetails,
				encryptionKeyDetails: b?.encryptionKeyDetails,
				details: b?.details ?? {},
				detailsMeta: b?.detailsMeta ?? {},
			};

			if (!external.signingKey || !external.encryptionKey) {
				throw new HttpError(STATUS.BadGateway, "invalid identity payload from server");
			}

			await ensureDir(ctx.contactsDir);
			const contactName = name ?? external.fingerprint.substring(0, 16);
			const contactPath = `${ctx.contactsDir}/${contactName}.json`;
			await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2));

			return json({ ok: true, name: contactName, fingerprint: external.fingerprint });
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

		if (req.method === "POST" && url.pathname === "/api/v1/revoke/detail") {
			const body = await readJson<{
				path?: unknown;
				reason?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				push?: unknown;
				server?: unknown;
			}>(req);
			const path = typeof body.path === "string" ? body.path : undefined;
			const reason = typeof body.reason === "string" ? body.reason : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const push = Boolean(body.push);
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			if (!path) throw new HttpError(STATUS.BadRequest, "path is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			
			if (!identity.details.has(path)) {
				throw new HttpError(STATUS.NotFound, "detail not found");
			}

			const certificate = identity.revokeDetail(path, reason);
			await saveIdentity(ctx, password, identity);

			if (push) {
				const server = resolveServer(ctx, serverOverride);
				const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						fingerprint: identity.toFingerprint(),
						type: "detail",
						target: path,
						certificate,
					}),
				});

				if (!res.ok) {
					let pushReason = `HTTP ${res.status}`;
					try {
						const body = await res.json();
						if (body?.error) pushReason = body.error;
					} catch {
						// ignore
					}
					throw new HttpError(STATUS.BadGateway, `failed to push revocation: ${pushReason}`);
				}
			}

			return json({ ok: true, path, revoked: true });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/revoke/identity") {
			const body = await readJson<{
				reason?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				push?: unknown;
				server?: unknown;
			}>(req);
			const reason = typeof body.reason === "string" ? body.reason : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const push = Boolean(body.push);
			const serverOverride = typeof body.server === "string" ? body.server : undefined;
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			
			if (identity.isRevoked()) {
				throw new HttpError(STATUS.Conflict, "identity is already revoked");
			}

			const certificate = identity.createIdentityRevocation(reason);
			await saveIdentity(ctx, password, identity);

			if (push) {
				const server = resolveServer(ctx, serverOverride);
				const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						fingerprint: identity.toFingerprint(),
						type: "identity",
						certificate,
					}),
				});

				if (!res.ok) {
					let pushReason = `HTTP ${res.status}`;
					try {
						const body = await res.json();
						if (body?.error) pushReason = body.error;
					} catch {
						// ignore
					}
					throw new HttpError(STATUS.BadGateway, `failed to push revocation: ${pushReason}`);
				}
			}

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

			const ctx = await getContext(home);
			const { identity } = await loadAndMaybeUpgrade(ctx, password, identityName);

			const emergencyCert = identity.generateEmergencyRevocationCertificate();
			
			return json({
				type: "ebp-emergency-revocation-certificate",
				version: 1,
				fingerprint: identity.toFingerprint(),
				certificate: emergencyCert,
				createdAt: new Date().toISOString(),
				warning: "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/server/identities") {
			const home = url.searchParams.get("home") ?? undefined;
			const serverOverride = url.searchParams.get("server") ?? undefined;
			const page = url.searchParams.get("page") ?? undefined;
			const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const server = resolveServer(ctx, serverOverride ?? undefined);

			const path = query ? "/api/v1/identities/search" : "/api/v1/identities";
			const serverUrl = new URL(apiUrl(server, path));
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

serve(handleRequest, { port: PORT });
console.log(`EBP GUI local backend listening on http://localhost:${PORT}`);

