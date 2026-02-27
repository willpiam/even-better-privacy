#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { serve } from "std/http/server";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Identity, ExternalIdentity, IdentityPublicData } from "../../core/Identity.ts";
import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";
import { KyberEncryptionKey } from "../../core/Kyber.ts";
import { PROTOCOL_VERSION, COMPONENT_VERSIONS, FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
	createFileCleartextEnvelope,
	parseFileCleartextEnvelope,
	MAX_ENCRYPTED_FILE_BYTES,
} from "../../core/FilePayload.ts";
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
} from "../../cli/utils.ts";

type JsonValue = Record<string, unknown>;
type MailAuthSecrets = { imapPassword: string; smtpPassword: string };
type MailAccountConfig = {
	gmailMode: boolean;
	imapHost: string;
	imapPort: number;
	imapSecure: boolean;
	smtpHost: string;
	smtpPort: number;
	smtpSecure: boolean;
	username: string;
	fromEmail: string;
	fromName: string;
	persistSecrets: boolean;
};
type MailAccountRecord = {
	id: string;
	name: string;
	config: MailAccountConfig;
	createdAt: number;
	updatedAt: number;
};
type MailAccountStore = {
	selectedAccountId: string | null;
	accounts: MailAccountRecord[];
};
type MailSecretsStore = Record<string, MailAuthSecrets>;
type EncryptedMailSecretsEnvelope = {
	version: 1;
	algorithm: "AES-GCM";
	kdf: "PBKDF2-SHA-256";
	iterations: number;
	salt: string;
	iv: string;
	ciphertext: string;
};

const DEFAULT_MAIL_ACCOUNT: MailAccountConfig = {
	gmailMode: false,
	imapHost: "",
	imapPort: 993,
	imapSecure: true,
	smtpHost: "",
	smtpPort: 465,
	smtpSecure: true,
	username: "",
	fromEmail: "",
	fromName: "",
	persistSecrets: false,
};
const MAIL_ACCOUNT_FILE = "mail-account.json";
const MAIL_SECRET_FILE = "mail-account.secrets.json";
const mailSecretCache = new Map<string, MailSecretsStore>();
const mailPinCache = new Map<string, string>();
const DEFAULT_MAIL_STORE: MailAccountStore = { selectedAccountId: null, accounts: [] };
const MAIL_SECRETS_KDF_ITERATIONS = 210_000;

const STATIC_ROOT = new URL("..", import.meta.url);
const PROJECT_ROOT = new URL("../..", import.meta.url);
const HOST = Deno.env.get("GUI_BACKEND_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("GUI_BACKEND_PORT") ?? "8787");
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "content-type",
	"access-control-allow-methods": "GET,POST,OPTIONS",
};

function randomHex(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeFileName(fileName: string): string {
	const normalized = fileName.replace(/\\/g, "/");
	const base = normalized.split("/").pop() || "encrypted.bin";
	const withoutControl = Array.from(base).filter((ch) => {
		const code = ch.charCodeAt(0);
		return !(code <= 31 || code === 127);
	}).join("");
	return withoutControl.replace(/\.\./g, "_");
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const out = new Uint8Array(bytes.length);
	out.set(bytes);
	return out.buffer;
}

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
const VERSION_MAP = FILE_FORMAT_VERSIONS as Readonly<Record<string, number>>;
const ENCRYPTED_FILE_FORMAT_VERSION = VERSION_MAP.encryptedFile ?? 1;
const ENCRYPTED_SIGNED_FILE_FORMAT_VERSION = VERSION_MAP.encryptedSignedFile ?? 1;

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
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
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

	let fileUrl: URL;
	if (target.startsWith("assets/")) {
		fileUrl = new URL(target, PROJECT_ROOT);
	} else {
		fileUrl = new URL(target, STATIC_ROOT);
	}
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

function toSafeString(value: unknown, max = 512): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clampPort(value: unknown, fallback: number): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
	return n;
}

function asBool(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function mailboxPath(identityDir: string, fileName: string): string {
	return `${identityDir}/${fileName}`;
}

async function readJsonFile<T>(path: string): Promise<T | null> {
	try {
		const raw = await Deno.readTextFile(path);
		return JSON.parse(raw) as T;
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return null;
		return null;
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
	try {
		await Deno.chmod(path, 0o600);
	} catch {
		// Best effort on platforms where chmod may not be supported.
	}
}

function isMailAccountConfig(value: unknown): value is MailAccountConfig {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.imapHost === "string" && typeof v.smtpHost === "string" && typeof v.username === "string";
}

function normalizeMailConfig(
	base: MailAccountConfig,
	payload?: Record<string, unknown> | null,
): MailAccountConfig {
	const p = payload ?? {};
	const next: MailAccountConfig = {
		gmailMode: asBool(p.gmailMode, base.gmailMode),
		imapHost: toSafeString(p.imapHost ?? base.imapHost),
		imapPort: clampPort(p.imapPort ?? base.imapPort, 993),
		imapSecure: asBool(p.imapSecure, base.imapSecure),
		smtpHost: toSafeString(p.smtpHost ?? base.smtpHost),
		smtpPort: clampPort(p.smtpPort ?? base.smtpPort, 465),
		smtpSecure: asBool(p.smtpSecure, base.smtpSecure),
		username: toSafeString(p.username ?? base.username),
		fromEmail: toSafeString(p.fromEmail ?? base.fromEmail),
		fromName: toSafeString(p.fromName ?? base.fromName),
		persistSecrets: asBool(p.persistSecrets, base.persistSecrets),
	};
	if (!next.imapHost || !next.smtpHost || !next.username || !next.fromEmail) {
		throw new HttpError(STATUS.BadRequest, "imapHost, smtpHost, username, and fromEmail are required");
	}
	return next;
}

async function getMailStore(identityDir: string): Promise<MailAccountStore> {
	const raw = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_ACCOUNT_FILE));
	if (!raw) return { ...DEFAULT_MAIL_STORE };
	if (isMailAccountConfig(raw)) {
		const now = Date.now();
		return {
			selectedAccountId: "default",
			accounts: [{
				id: "default",
				name: "Default account",
				config: raw,
				createdAt: now,
				updatedAt: now,
			}],
		};
	}
	if (typeof raw === "object" && raw) {
		const parsed = raw as Partial<MailAccountStore>;
		const accounts = Array.isArray(parsed.accounts) ? parsed.accounts.filter((item) => {
			if (!item || typeof item !== "object") return false;
			const rec = item as Partial<MailAccountRecord>;
			return typeof rec.id === "string" && typeof rec.name === "string" && isMailAccountConfig(rec.config);
		}).map((item) => item as MailAccountRecord) : [];
		const selectedAccountId = typeof parsed.selectedAccountId === "string" ? parsed.selectedAccountId : null;
		return { selectedAccountId, accounts };
	}
	return { ...DEFAULT_MAIL_STORE };
}

async function saveMailStore(identityDir: string, store: MailAccountStore): Promise<void> {
	await writePrivateJson(mailboxPath(identityDir, MAIL_ACCOUNT_FILE), store);
}

function isEncryptedSecretsEnvelope(value: unknown): value is EncryptedMailSecretsEnvelope {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return v.version === 1 &&
		v.algorithm === "AES-GCM" &&
		v.kdf === "PBKDF2-SHA-256" &&
		typeof v.iterations === "number" &&
		typeof v.salt === "string" &&
		typeof v.iv === "string" &&
		typeof v.ciphertext === "string";
}

function parseLegacySecretsStore(raw: unknown): MailSecretsStore {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const maybeLegacy = raw as Partial<MailAuthSecrets>;
	if (typeof maybeLegacy.imapPassword === "string" && typeof maybeLegacy.smtpPassword === "string") {
		return { default: { imapPassword: maybeLegacy.imapPassword, smtpPassword: maybeLegacy.smtpPassword } };
	}
	const out: MailSecretsStore = {};
	for (const [accountId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const sec = value as Partial<MailAuthSecrets>;
		if (typeof sec.imapPassword === "string" && typeof sec.smtpPassword === "string") {
			out[accountId] = { imapPassword: sec.imapPassword, smtpPassword: sec.smtpPassword };
		}
	}
	return out;
}

async function deriveMailSecretsKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		{ name: "PBKDF2" },
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

async function encryptSecretsStore(store: MailSecretsStore, pin: string): Promise<EncryptedMailSecretsEnvelope> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveMailSecretsKey(pin, salt, MAIL_SECRETS_KDF_ITERATIONS);
	const plaintext = new TextEncoder().encode(JSON.stringify(store));
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
	return {
		version: 1,
		algorithm: "AES-GCM",
		kdf: "PBKDF2-SHA-256",
		iterations: MAIL_SECRETS_KDF_ITERATIONS,
		salt: bytesToBase64(salt),
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
	};
}

async function decryptSecretsEnvelope(envelope: EncryptedMailSecretsEnvelope, pin: string): Promise<MailSecretsStore> {
	try {
		const key = await deriveMailSecretsKey(pin, base64ToBytes(envelope.salt), envelope.iterations);
		const iv = base64ToBytes(envelope.iv);
		const ciphertext = base64ToBytes(envelope.ciphertext);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: toArrayBuffer(iv) },
			key,
			toArrayBuffer(ciphertext),
		);
		return parseLegacySecretsStore(JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext))));
	} catch {
		throw new HttpError(STATUS.Unauthorized, "invalid email pin");
	}
}

async function getMailSecretsStatus(identityDir: string): Promise<{ inMemory: boolean; locked: boolean; store: MailSecretsStore | null }> {
	const cached = mailSecretCache.get(identityDir);
	if (cached) return { inMemory: true, locked: false, store: cached };
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) return { inMemory: false, locked: false, store: {} };
	if (isEncryptedSecretsEnvelope(diskSecrets)) return { inMemory: false, locked: true, store: null };
	return { inMemory: false, locked: false, store: parseLegacySecretsStore(diskSecrets) };
}

async function getMailSecretsStore(identityDir: string): Promise<MailSecretsStore> {
	const cached = mailSecretCache.get(identityDir);
	if (cached) return cached;
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) {
		const empty: MailSecretsStore = {};
		mailSecretCache.set(identityDir, empty);
		return empty;
	}
	if (isEncryptedSecretsEnvelope(diskSecrets)) {
		const pin = mailPinCache.get(identityDir);
		if (!pin) throw new HttpError(STATUS.Unauthorized, "email pin required");
		const decrypted = await decryptSecretsEnvelope(diskSecrets, pin);
		mailSecretCache.set(identityDir, decrypted);
		return decrypted;
	}
	const legacy = parseLegacySecretsStore(diskSecrets);
	mailSecretCache.set(identityDir, legacy);
	return legacy;
}

async function unlockMailSecretsWithPin(identityDir: string, pin: string): Promise<MailSecretsStore> {
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) {
		const empty: MailSecretsStore = {};
		mailSecretCache.set(identityDir, empty);
		mailPinCache.set(identityDir, pin);
		return empty;
	}
	if (isEncryptedSecretsEnvelope(diskSecrets)) {
		const decrypted = await decryptSecretsEnvelope(diskSecrets, pin);
		mailSecretCache.set(identityDir, decrypted);
		mailPinCache.set(identityDir, pin);
		return decrypted;
	}
	const legacy = parseLegacySecretsStore(diskSecrets);
	mailSecretCache.set(identityDir, legacy);
	mailPinCache.set(identityDir, pin);
	return legacy;
}

async function saveMailSecretsStore(identityDir: string, store: MailSecretsStore): Promise<void> {
	mailSecretCache.set(identityDir, store);
	if (Object.keys(store).length === 0) {
		try {
			await Deno.remove(mailboxPath(identityDir, MAIL_SECRET_FILE));
		} catch (e) {
			if (!(e instanceof Deno.errors.NotFound)) throw e;
		}
		return;
	}
	const pin = mailPinCache.get(identityDir);
	if (!pin) throw new HttpError(STATUS.Unauthorized, "email pin required");
	const encrypted = await encryptSecretsStore(store, pin);
	await writePrivateJson(mailboxPath(identityDir, MAIL_SECRET_FILE), encrypted);
}

async function resolveMailAccount(identityDir: string, accountId?: string): Promise<{ account: MailAccountRecord; secrets: MailAuthSecrets }> {
	const store = await getMailStore(identityDir);
	if (!store.accounts.length) throw new HttpError(STATUS.BadRequest, "mail account is not configured");
	const selected = accountId ?? store.selectedAccountId ?? store.accounts[0].id;
	const account = store.accounts.find((entry) => entry.id === selected);
	if (!account) throw new HttpError(STATUS.NotFound, "mail account not found");
	const secretStore = await getMailSecretsStore(identityDir);
	const secrets = secretStore[account.id];
	if (!secrets?.imapPassword || !secrets?.smtpPassword) {
		throw new HttpError(STATUS.BadRequest, "mail credentials are not configured");
	}
	return { account, secrets };
}

function getAddressText(addr: unknown): string {
	if (!Array.isArray(addr) || addr.length === 0) return "";
	const first = addr[0] as Record<string, unknown>;
	const name = typeof first.name === "string" ? first.name : "";
	const address = typeof first.address === "string" ? first.address : "";
	if (!name) return address;
	return `${name} <${address}>`;
}

function getIdentityDetailValue(details: unknown, path: string): string | null {
	if (!details || typeof details !== "object") return null;
	const record = details as Record<string, unknown>;
	const raw = record[path];
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
	return null;
}

function getIdentityDetailMeta(detailsMeta: unknown, path: string): Record<string, unknown> | null {
	if (!detailsMeta || typeof detailsMeta !== "object") return null;
	const raw = (detailsMeta as Record<string, unknown>)[path];
	if (!raw || typeof raw !== "object") return null;
	return raw as Record<string, unknown>;
}

function extractEmailAddress(value: string): string {
	const text = (value ?? "").trim();
	const angle = text.match(/<([^>]+)>/);
	const candidate = angle ? angle[1] : text;
	const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
	return match ? match[0].toLowerCase() : "";
}

function extractEbpPayload(text: string): Record<string, unknown> | null {
	const start = "-----BEGIN EBP MESSAGE-----";
	const end = "-----END EBP MESSAGE-----";
	const s = text.indexOf(start);
	const e = text.indexOf(end);
	if (s < 0 || e < 0 || e <= s) return null;
	const raw = text.slice(s + start.length, e).trim();
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
		return null;
	} catch {
		return null;
	}
}

function buildImapClient(config: MailAccountConfig, secrets: MailAuthSecrets): ImapFlow {
	const client = new ImapFlow({
		host: config.imapHost,
		port: config.imapPort,
		secure: config.imapSecure,
		auth: { user: config.username, pass: secrets.imapPassword },
		// Deno's node:zlib compatibility can intermittently fail with COMPRESS=DEFLATE on some providers.
		// Keep transport uncompressed for stability when fetching full message bodies.
		disableCompression: true,
		logger: false,
		socketTimeout: 20_000,
		greetingTimeout: 20_000,
	});
	// Some providers close TLS sockets without close_notify; don't let transport-level errors crash the process.
	client.on("error", (_err) => {
		// Swallow here; request handlers surface operation failures via caught await errors.
	});
	return client;
}

async function safeImapDisconnect(imap: ImapFlow): Promise<void> {
	try {
		await imap.logout();
	} catch {
		try {
			imap.close();
		} catch {
			// ignore
		}
	}
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

async function deleteContact(ctx: CLIContext, name?: string, fingerprint?: string): Promise<string> {
	const byName = typeof name === "string" ? name.trim() : "";
	const byFingerprint = typeof fingerprint === "string" ? fingerprint.trim() : "";

	if (!byName && !byFingerprint) {
		throw new HttpError(STATUS.BadRequest, "name or fingerprint is required");
	}

	if (byName) {
		const contactPath = `${ctx.contactsDir}/${byName}.json`;
		try {
			await Deno.remove(contactPath);
			return byName;
		} catch (e) {
			if (!(e instanceof Deno.errors.NotFound)) throw e;
		}
	}

	if (!byFingerprint) {
		throw new HttpError(STATUS.NotFound, "contact not found");
	}

	try {
		for await (const entry of Deno.readDir(ctx.contactsDir)) {
			if (!entry.isFile || !entry.name.endsWith(".json")) continue;
			const contactName = entry.name.replace(".json", "");
			const contactPath = `${ctx.contactsDir}/${entry.name}`;
			const json = await Deno.readTextFile(contactPath);
			const contact = JSON.parse(json) as ExternalIdentity;
			if (
				typeof contact.fingerprint === "string" &&
				(contact.fingerprint === byFingerprint || contact.fingerprint.startsWith(byFingerprint))
			) {
				await Deno.remove(contactPath);
				return contactName;
			}
		}
	} catch (e) {
		if (!(e instanceof Deno.errors.NotFound)) throw e;
	}

	throw new HttpError(STATUS.NotFound, "contact not found");
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
			return json({
				ok: true,
				protocolVersion: PROTOCOL_VERSION,
				componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
			});
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
				componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/mail/account") {
			const home = url.searchParams.get("home") ?? undefined;
			const requestedAccountId = toSafeString(url.searchParams.get("accountId"), 128) || undefined;
			const ctx = await getContext(home ?? undefined);
			const store = await getMailStore(ctx.identityDir);
			const selectedId = requestedAccountId ?? store.selectedAccountId ?? store.accounts[0]?.id ?? null;
			const account = selectedId ? (store.accounts.find((entry) => entry.id === selectedId) ?? null) : null;
			const secretStatus = await getMailSecretsStatus(ctx.identityDir);
			const secrets = account && secretStatus.store ? secretStatus.store[account.id] : undefined;
			return json({
				accountId: account?.id ?? null,
				accountName: account?.name ?? null,
				account: account?.config ?? null,
				selectedAccountId: store.selectedAccountId ?? account?.id ?? null,
				accounts: store.accounts.map((entry) => ({ id: entry.id, name: entry.name })),
				hasImapPassword: Boolean(secrets?.imapPassword),
				hasSmtpPassword: Boolean(secrets?.smtpPassword),
				secretsInMemory: secretStatus.inMemory,
				secretsLocked: secretStatus.locked,
				localOnly: true,
			});
		}

		if (req.method === "GET" && url.pathname === "/api/v1/mail/accounts") {
			const home = url.searchParams.get("home") ?? undefined;
			const ctx = await getContext(home ?? undefined);
			const store = await getMailStore(ctx.identityDir);
			const secretStatus = await getMailSecretsStatus(ctx.identityDir);
			const secretStore = secretStatus.store ?? {};
			return json({
				selectedAccountId: store.selectedAccountId,
				secretsInMemory: secretStatus.inMemory,
				secretsLocked: secretStatus.locked,
				accounts: store.accounts.map((entry) => ({
					id: entry.id,
					name: entry.name,
					updatedAt: entry.updatedAt,
					username: entry.config.username,
					fromEmail: entry.config.fromEmail,
					imapHost: entry.config.imapHost,
					smtpHost: entry.config.smtpHost,
					persistSecrets: entry.config.persistSecrets,
					hasStoredSecret: secretStatus.locked ? null : Boolean(secretStore[entry.id]),
				})),
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/account/select") {
			const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const accountId = toSafeString(body.accountId, 128);
			if (!accountId) throw new HttpError(STATUS.BadRequest, "accountId is required");
			const ctx = await getContext(home ?? undefined);
			const store = await getMailStore(ctx.identityDir);
			const exists = store.accounts.some((entry) => entry.id === accountId);
			if (!exists) throw new HttpError(STATUS.NotFound, "mail account not found");
			store.selectedAccountId = accountId;
			await saveMailStore(ctx.identityDir, store);
			return json({ ok: true, selectedAccountId: accountId });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/account/delete") {
			const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const accountId = toSafeString(body.accountId, 128);
			if (!accountId) throw new HttpError(STATUS.BadRequest, "accountId is required");
			const ctx = await getContext(home ?? undefined);
			const store = await getMailStore(ctx.identityDir);
			const exists = store.accounts.some((entry) => entry.id === accountId);
			if (!exists) throw new HttpError(STATUS.NotFound, "mail account not found");

			const secretStatus = await getMailSecretsStatus(ctx.identityDir);
			if (secretStatus.locked) {
				throw new HttpError(STATUS.Unauthorized, "email pin required");
			}
			store.accounts = store.accounts.filter((entry) => entry.id !== accountId);
			if (store.selectedAccountId === accountId) {
				store.selectedAccountId = store.accounts[0]?.id ?? null;
			}
			await saveMailStore(ctx.identityDir, store);
			const secretStore = secretStatus.store ?? {};
			if (secretStore[accountId]) {
				delete secretStore[accountId];
				await saveMailSecretsStore(ctx.identityDir, secretStore);
			}
			return json({ ok: true, deletedAccountId: accountId, selectedAccountId: store.selectedAccountId });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/unlock") {
			const body = await readJson<{ home?: unknown; pin?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const pin = typeof body.pin === "string" ? body.pin : "";
			if (!pin) throw new HttpError(STATUS.BadRequest, "email pin is required");
			const ctx = await getContext(home ?? undefined);
			const store = await unlockMailSecretsWithPin(ctx.identityDir, pin);
			return json({
				ok: true,
				unlocked: true,
				accountCount: Object.keys(store).length,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/account") {
			const body = await readJson<{
				home?: unknown;
				account?: unknown;
				accountId?: unknown;
				createNew?: unknown;
				accountName?: unknown;
				imapPassword?: unknown;
				smtpPassword?: unknown;
				pin?: unknown;
			}>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const ctx = await getContext(home ?? undefined);
			const accountPayload = body.account && typeof body.account === "object"
				? body.account as Record<string, unknown>
				: null;
			const requestedAccountId = toSafeString(body.accountId, 128);
			const createNew = Boolean(body.createNew);
			const accountName = toSafeString(body.accountName, 128) || "Mail account";
			const pin = typeof body.pin === "string" ? body.pin : "";
			const store = await getMailStore(ctx.identityDir);
			const current = createNew
				? null
				: requestedAccountId
				? store.accounts.find((entry) => entry.id === requestedAccountId)
				: (store.selectedAccountId ? store.accounts.find((entry) => entry.id === store.selectedAccountId) : null);
			const accountConfig = normalizeMailConfig(current?.config ?? DEFAULT_MAIL_ACCOUNT, accountPayload);
			const accountId = current?.id ?? `mail-${randomHex(8)}`;
			const now = Date.now();
			const nextRecord: MailAccountRecord = {
				id: accountId,
				name: accountName,
				config: accountConfig,
				createdAt: current?.createdAt ?? now,
				updatedAt: now,
			};
			if (current) {
				store.accounts = store.accounts.map((entry) => entry.id === accountId ? nextRecord : entry);
			} else {
				store.accounts.push(nextRecord);
			}
			store.selectedAccountId = accountId;
			await saveMailStore(ctx.identityDir, store);

			if (pin) {
				mailPinCache.set(ctx.identityDir, pin);
			}
			const secretStore = await getMailSecretsStore(ctx.identityDir);
			const existingSecrets = secretStore[accountId] ?? { imapPassword: "", smtpPassword: "" };
			const nextSecrets: MailAuthSecrets = {
				imapPassword: typeof body.imapPassword === "string" && body.imapPassword.length > 0
					? body.imapPassword
					: existingSecrets.imapPassword,
				smtpPassword: typeof body.smtpPassword === "string" && body.smtpPassword.length > 0
					? body.smtpPassword
					: existingSecrets.smtpPassword,
			};
			secretStore[accountId] = nextSecrets;
			if (!accountConfig.persistSecrets) {
				delete secretStore[accountId];
			}
			await saveMailSecretsStore(ctx.identityDir, secretStore);
			return json({
				ok: true,
				accountId,
				accountName: nextRecord.name,
				account: accountConfig,
				selectedAccountId: store.selectedAccountId,
				hasImapPassword: Boolean(nextSecrets.imapPassword),
				hasSmtpPassword: Boolean(nextSecrets.smtpPassword),
				localOnly: true,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/test") {
			const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const accountId = toSafeString(body.accountId, 128) || undefined;
			const ctx = await getContext(home ?? undefined);
			const resolved = await resolveMailAccount(ctx.identityDir, accountId);
			const account = resolved.account.config;
			const secrets = resolved.secrets;

			const imap = buildImapClient(account, secrets);
			try {
				await imap.connect();
				await imap.mailboxOpen("INBOX", { readOnly: true });
			} finally {
				await safeImapDisconnect(imap);
			}

			const transport = nodemailer.createTransport({
				host: account.smtpHost,
				port: account.smtpPort,
				secure: account.smtpSecure,
				auth: { user: account.username, pass: secrets.smtpPassword },
			});
			await transport.verify();
			return json({ ok: true });
		}

		if (req.method === "GET" && url.pathname === "/api/v1/mail/messages") {
			const home = url.searchParams.get("home") ?? undefined;
			const accountId = toSafeString(url.searchParams.get("accountId"), 128) || undefined;
			const folder = toSafeString(url.searchParams.get("folder") ?? "INBOX", 128) || "INBOX";
			const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "20") || 20));
			const ctx = await getContext(home ?? undefined);
			const resolved = await resolveMailAccount(ctx.identityDir, accountId);
			const account = resolved.account.config;
			const secrets = resolved.secrets;

			const imap = buildImapClient(account, secrets);
			try {
				await imap.connect();
				const mailbox = await imap.mailboxOpen(folder, { readOnly: true });
				if (!mailbox.exists) return json({ folder, messages: [] });
				const start = Math.max(1, mailbox.exists - limit + 1);
				const range = `${start}:${mailbox.exists}`;
				const results: Array<Record<string, unknown>> = [];
				for await (const msg of imap.fetch(range, {
					uid: true,
					envelope: true,
					internalDate: true,
					flags: true,
				})) {
					results.push({
						uid: msg.uid,
						subject: msg.envelope?.subject ?? "(no subject)",
						from: getAddressText(msg.envelope?.from),
						to: getAddressText(msg.envelope?.to),
						date: msg.internalDate ? new Date(msg.internalDate).getTime() : null,
						seen: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : false,
					});
				}
				results.reverse();
				return json({ accountId: resolved.account.id, folder, messages: results });
			} finally {
				await safeImapDisconnect(imap);
			}
		}

		if (req.method === "GET" && url.pathname === "/api/v1/mail/message") {
			const home = url.searchParams.get("home") ?? undefined;
			const accountId = toSafeString(url.searchParams.get("accountId"), 128) || undefined;
			const folder = toSafeString(url.searchParams.get("folder") ?? "INBOX", 128) || "INBOX";
			const uidRaw = url.searchParams.get("uid");
			const uid = Number(uidRaw);
			if (!Number.isInteger(uid) || uid <= 0) {
				throw new HttpError(STATUS.BadRequest, "uid must be a positive integer");
			}
			const ctx = await getContext(home ?? undefined);
			const resolved = await resolveMailAccount(ctx.identityDir, accountId);
			const account = resolved.account.config;
			const secrets = resolved.secrets;

			const imap = buildImapClient(account, secrets);
			try {
				await imap.connect();
				await imap.mailboxOpen(folder, { readOnly: true });
				const one = await imap.fetchOne(uid, {
					uid: true,
					envelope: true,
					internalDate: true,
					flags: true,
					source: true,
				}, { uid: true });
				if (!one || !one.source) throw new HttpError(STATUS.NotFound, "message not found");
				const parsed = await simpleParser(one.source);
				const textBody = parsed.text ?? "";
				const htmlBody = parsed.html ? String(parsed.html) : "";
				const ebpPayload = extractEbpPayload(textBody || htmlBody);
				return json({
					accountId: resolved.account.id,
					uid: one.uid,
					subject: one.envelope?.subject ?? "(no subject)",
					from: getAddressText(one.envelope?.from),
					to: getAddressText(one.envelope?.to),
					date: one.internalDate ? new Date(one.internalDate).getTime() : null,
					text: textBody,
					html: htmlBody,
					attachments: parsed.attachments.map((att: { filename?: string; contentType?: string; size?: number }) => ({
						filename: att.filename ?? "attachment",
						contentType: att.contentType ?? "application/octet-stream",
						size: att.size ?? 0,
					})),
					ebpPayload,
				});
			} finally {
				await safeImapDisconnect(imap);
			}
		}

		if (req.method === "POST" && url.pathname === "/api/v1/mail/send") {
			const body = await readJson<{
				home?: unknown;
				accountId?: unknown;
				to?: unknown;
				subject?: unknown;
				text?: unknown;
				html?: unknown;
			}>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const accountId = toSafeString(body.accountId, 128) || undefined;
			const to = toSafeString(body.to, 512);
			const subject = toSafeString(body.subject, 512);
			const text = typeof body.text === "string" ? body.text : "";
			const htmlText = typeof body.html === "string" ? body.html : "";
			if (!to || !subject) throw new HttpError(STATUS.BadRequest, "to and subject are required");
			if (!text && !htmlText) throw new HttpError(STATUS.BadRequest, "text or html body is required");
			const ctx = await getContext(home ?? undefined);
			const resolved = await resolveMailAccount(ctx.identityDir, accountId);
			const account = resolved.account.config;
			const secrets = resolved.secrets;
			const transport = nodemailer.createTransport({
				host: account.smtpHost,
				port: account.smtpPort,
				secure: account.smtpSecure,
				auth: { user: account.username, pass: secrets.smtpPassword },
			});
			const from = account.fromName
				? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
				: account.fromEmail;
			const info = await transport.sendMail({
				from,
				to,
				subject,
				text: text || undefined,
				html: htmlText || undefined,
			});
			return json({ ok: true, accountId: resolved.account.id, messageId: info.messageId ?? null });
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
			if (!isValidFingerprintBech32(contact.fingerprint)) {
				throw new HttpError(STATUS.BadRequest, "contact fingerprint must be valid bech32");
			}

			const ctx = await getContext(home);
			await ensureDir(ctx.contactsDir);
			const contactName = name ?? contact.fingerprint.substring(0, 16);
			const contactPath = `${ctx.contactsDir}/${contactName}.json`;
			await Deno.writeTextFile(contactPath, JSON.stringify(contact, null, 2));

			return json({ ok: true, name: contactName, fingerprint: contact.fingerprint });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/contacts/delete") {
			const body = await readJson<{ name?: unknown; fingerprint?: unknown; home?: unknown }>(req);
			const home = typeof body.home === "string" ? body.home : undefined;
			const name = typeof body.name === "string" ? body.name : undefined;
			const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : undefined;
			const ctx = await getContext(home);
			const deletedName = await deleteContact(ctx, name, fingerprint);
			return json({ ok: true, name: deletedName });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/sign") {
			const body = await readJson<{
				message?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				detached?: unknown;
				includeIdentity?: unknown;
				includeSalt?: unknown;
				salt?: unknown;
			}>(req);
			const message = typeof body.message === "string" ? body.message : undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const detached = Boolean(body.detached);
			const includeIdentity = Boolean(body.includeIdentity);
			const includeSalt = body.includeSalt === undefined ? true : Boolean(body.includeSalt);
			const providedSalt = typeof body.salt === "string" ? body.salt : undefined;
			if (!message) throw new HttpError(STATUS.BadRequest, "message is required");
			if (!password) throw new HttpError(STATUS.BadRequest, "password is required");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);
			const salt = providedSalt ?? (includeSalt ? randomHex(16) : "");
			const signature = (identity as Identity & { signMessage: (value: string, optionalSalt?: string) => string })
				.signMessage(message, salt);
			const messageHash = sha256Hex(message);
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
					messageHash,
					salt,
					signature,
					identity: identityPayload,
				});
			}
			return json({
				type: "ebp-signed-message",
				version: FILE_FORMAT_VERSIONS.signedMessage,
				fingerprint: identity.toFingerprint(),
				message,
				messageHash,
				salt,
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
				salt?: unknown;
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
			let messageHash: string;
			let salt = "";

			if (typeof payload === "object" && payload && "type" in payload) {
				const obj = payload as Record<string, unknown>;
				if (obj.type === "ebp-signed-message") {
					message = String(obj.message ?? "");
					messageHash = String(obj.messageHash ?? "");
					salt = String(obj.salt ?? "");
					signature = String(obj.signature ?? "");
					fingerprint = String(obj.fingerprint ?? "");
					if (!message || !signature || !messageHash) {
						throw new HttpError(STATUS.BadRequest, "signed message payload missing required fields");
					}
					if (sha256Hex(message) !== messageHash) {
						throw new HttpError(STATUS.BadRequest, "message hash mismatch");
					}
				} else if (obj.type === "ebp-signature") {
					if (!messageOverride) {
						throw new HttpError(STATUS.BadRequest, "message is required for detached signatures");
					}
					message = messageOverride;
					messageHash = String(obj.messageHash ?? "");
					salt = String(obj.salt ?? "");
					signature = String(obj.signature ?? "");
					fingerprint = String(obj.fingerprint ?? "");
					if (!signature || !messageHash) {
						throw new HttpError(STATUS.BadRequest, "detached signature payload missing required fields");
					}
					if (sha256Hex(message) !== messageHash) {
						throw new HttpError(STATUS.BadRequest, "message hash mismatch");
					}
				} else {
					throw new HttpError(STATUS.BadRequest, "unsupported payload type");
				}
			} else {
				if (!messageOverride || !signatureOverride) {
					throw new HttpError(STATUS.BadRequest, "message and signature required for detached verify");
				}
				message = messageOverride;
				messageHash = sha256Hex(messageOverride);
				salt = typeof body.salt === "string" ? body.salt : "";
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
			const verified = (Identity as typeof Identity & {
				VerifySignature: (sender: ExternalIdentity, value: string, sig: string, optionalSalt?: string) => boolean;
			}).VerifySignature(contact, message, signature, salt);
			return json({ verified });
		}

		if (req.method === "POST" && url.pathname === "/api/v1/identity/fingerprint-from-public") {
			const body = await readJson<{ publicIdentity?: unknown }>(req);
			const publicIdentity = body.publicIdentity;
			if (!publicIdentity || typeof publicIdentity !== "object") {
				throw new HttpError(STATUS.BadRequest, "publicIdentity object is required");
			}
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
			const externalIdentity: ExternalIdentity = {
				fingerprint: typeof candidate.fingerprint === "string" ? candidate.fingerprint : "",
				signingKey,
				signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
				signingKeyDetails: candidate.signingKeyDetails,
				encryptionKey,
				encryptionKeyType: "kyber",
				encryptionKeyDetails: candidate.encryptionKeyDetails,
				details: (candidate.details as ExternalIdentity["details"]) ?? {},
			};
			const computedFingerprint = computeExternalFingerprint(externalIdentity);
			if (!computedFingerprint) {
				throw new HttpError(STATUS.BadRequest, "could not compute fingerprint from provided public identity");
			}
			return json({ fingerprint: computedFingerprint });
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
				senderEmail?: unknown;
				home?: unknown;
				identity?: unknown;
			}>(req);
			const payload = body.payload as Record<string, unknown> | undefined;
			const password = typeof body.password === "string" ? body.password : undefined;
			const sender = typeof body.sender === "string" ? body.sender : undefined;
			const senderEmail = typeof body.senderEmail === "string" ? body.senderEmail : undefined;
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
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
				}
				return json({
					message,
					verified: null,
					verifyStatus: "unsigned",
					signerFingerprint: null,
					signerEmail: null,
					signerEmailVerified: null,
					signerMatchesSenderEmail: null,
				});
			}

			if (type === "ebp-encrypted-signed-message") {
				const ciphertext = String(payload.ciphertext ?? "");
				const senderFp = typeof payload.senderFingerprint === "string" ? payload.senderFingerprint : undefined;
				let contact: ExternalIdentity | undefined;
				let isKnownContact = false;
				let signerFingerprint: string | null = senderFp ?? null;
				let signerEmail: string | null = null;
				let signerEmailVerified: boolean | null = null;
				let signerMatchesSenderEmail: boolean | null = null;
				
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
							detailsMeta: data.detailsMeta ?? {},
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
									signerEmail,
									signerEmailVerified,
									signerMatchesSenderEmail,
								});
							} catch {
								return json({
									message,
									verified: null,
									verifyStatus: "sender_not_found",
									signerFingerprint,
									signerEmail,
									signerEmailVerified,
									signerMatchesSenderEmail,
								});
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
									signerEmail,
									signerEmailVerified,
									signerMatchesSenderEmail,
								});
							} catch {
								return json({
									message,
									verified: null,
									verifyStatus: "sender_not_in_contacts",
									signerFingerprint,
									signerEmail,
									signerEmailVerified,
									signerMatchesSenderEmail,
								});
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
							signerEmail,
							signerEmailVerified,
							signerMatchesSenderEmail,
						});
					} catch {
						return json({
							message,
							verified: null,
							verifyStatus: "sender_not_specified",
							signerFingerprint,
							signerEmail,
							signerEmailVerified,
							signerMatchesSenderEmail,
						});
					}
				}
				
				try {
					const computedFingerprint = computeExternalFingerprint(contact);
					signerFingerprint = contact.fingerprint ?? signerFingerprint;
					signerEmail = getIdentityDetailValue(contact.details, "email");
					const emailMeta = getIdentityDetailMeta(
						(contact as ExternalIdentity & { detailsMeta?: unknown }).detailsMeta,
						"email",
					);
					signerEmailVerified = emailMeta && typeof emailMeta.verified === "boolean"
						? Boolean(emailMeta.verified)
						: null;
					const senderEmailNormalized = extractEmailAddress(senderEmail ?? "");
					const signerEmailNormalized = extractEmailAddress(signerEmail ?? "");
					if (senderEmailNormalized && signerEmailNormalized) {
						signerMatchesSenderEmail = senderEmailNormalized === signerEmailNormalized;
					}
					if (!computedFingerprint || computedFingerprint !== contact.fingerprint) {
						const message = safeDecrypt(ciphertext);
						try {
							const inner = JSON.parse(message);
							return json({
								message: inner.message ?? message,
								verified: false,
								verifyStatus: "fingerprint_mismatch",
								signerFingerprint,
								signerEmail,
								signerEmailVerified,
								signerMatchesSenderEmail,
							});
						} catch {
							return json({
								message,
								verified: false,
								verifyStatus: "fingerprint_mismatch",
								signerFingerprint,
								signerEmail,
								signerEmailVerified,
								signerMatchesSenderEmail,
							});
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
								signerEmail,
								signerEmailVerified,
								signerMatchesSenderEmail,
							});
						} catch {
							return json({
								message,
								verified: false,
								verifyStatus: "fingerprint_mismatch",
								signerFingerprint,
								signerEmail,
								signerEmailVerified,
								signerMatchesSenderEmail,
							});
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
							signerEmail,
							signerEmailVerified,
							signerMatchesSenderEmail,
						});
					} else {
						return json({
							message: result.message,
							verified: false,
							verifyStatus: "invalid",
							signerFingerprint,
							signerEmail,
							signerEmailVerified,
							signerMatchesSenderEmail,
						});
					}
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - message may be corrupted or not intended for this identity");
				}
			}

			throw new HttpError(STATUS.BadRequest, "unsupported payload type");
		}

		if (req.method === "POST" && url.pathname === "/api/v1/encrypt-file") {
			const body = await readJson<{
				recipient?: unknown;
				sign?: unknown;
				password?: unknown;
				home?: unknown;
				identity?: unknown;
				fileName?: unknown;
				mimeType?: unknown;
				fileDataBase64?: unknown;
			}>(req);
			const recipient = typeof body.recipient === "string" ? body.recipient : undefined;
			const sign = Boolean(body.sign);
			const password = typeof body.password === "string" ? body.password : undefined;
			const home = typeof body.home === "string" ? body.home : undefined;
			const identityName = typeof body.identity === "string" ? body.identity : undefined;
			const fileNameRaw = typeof body.fileName === "string" ? body.fileName : "encrypted.bin";
			const mimeType = typeof body.mimeType === "string" && body.mimeType.length > 0
				? body.mimeType
				: "application/octet-stream";
			const fileDataBase64 = typeof body.fileDataBase64 === "string" ? body.fileDataBase64 : undefined;
			if (!recipient) throw new HttpError(STATUS.BadRequest, "recipient is required");
			if (!fileDataBase64) throw new HttpError(STATUS.BadRequest, "fileDataBase64 is required");
			const fileBytes = Uint8Array.from(atob(fileDataBase64), (c) => c.charCodeAt(0));
			if (fileBytes.length > MAX_ENCRYPTED_FILE_BYTES) {
				throw new HttpError(STATUS.BadRequest, `file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`);
			}

			const ctx = await getContext(home, identityName);
			const contact = await loadContact(ctx, recipient);
			const fileName = safeFileName(fileNameRaw);
			const envelope = createFileCleartextEnvelope(fileBytes, fileName, mimeType);
			const cleartext = JSON.stringify(envelope);

			if (sign) {
				if (!password) throw new HttpError(STATUS.BadRequest, "password is required when signing");
				const identity = await loadIdentity(ctx, password);
				const ciphertext = identity.signAndEncryptFor(cleartext, contact);
				return json({
					type: "ebp-encrypted-signed-file",
					version: ENCRYPTED_SIGNED_FILE_FORMAT_VERSION,
					recipientFingerprint: contact.fingerprint,
					senderFingerprint: identity.toFingerprint(),
					fileName,
					mimeType,
					fileSize: fileBytes.length,
					ciphertext,
				});
			}

			const ciphertext = Identity.EncryptFor(contact, cleartext);
			return json({
				type: "ebp-encrypted-file",
				version: ENCRYPTED_FILE_FORMAT_VERSION,
				recipientFingerprint: contact.fingerprint,
				fileName,
				mimeType,
				fileSize: fileBytes.length,
				ciphertext,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/v1/decrypt-file") {
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
			const ciphertext = String(payload.ciphertext ?? "");
			if (!ciphertext) throw new HttpError(STATUS.BadRequest, "payload missing ciphertext");

			const ctx = await getContext(home, identityName);
			const identity = await loadIdentity(ctx, password);

			let cleartextEnvelopeRaw = "";
			let verified: boolean | null = null;
			let verifyStatus = "unsigned";
			if (payload.type === "ebp-encrypted-file") {
				try {
					cleartextEnvelopeRaw = identity.encryptionKey.decrypt(ciphertext);
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - payload may be corrupted or not intended for this identity");
				}
			} else if (payload.type === "ebp-encrypted-signed-file") {
				let contact: ExternalIdentity;
				if (sender) {
					contact = await loadContact(ctx, sender);
				} else if (typeof payload.senderFingerprint === "string") {
					contact = await loadContact(ctx, payload.senderFingerprint.substring(0, 16));
				} else {
					throw new HttpError(STATUS.BadRequest, "sender is required for signed file payloads");
				}
				let result: { message: string; verified: boolean };
				try {
					result = identity.decryptAndVerify(ciphertext, contact);
				} catch {
					throw new HttpError(STATUS.BadRequest, "decryption failed - payload may be corrupted or not intended for this identity");
				}
				cleartextEnvelopeRaw = result.message;
				verified = result.verified;
				verifyStatus = result.verified ? "valid" : "invalid";
			} else {
				throw new HttpError(STATUS.BadRequest, "unsupported file payload type");
			}

			const envelope = parseFileCleartextEnvelope(cleartextEnvelopeRaw);
			if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
				throw new HttpError(STATUS.BadRequest, `decrypted file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`);
			}
			const fileDataBase64 = bytesToBase64(envelope.fileBytes);
			return json({
				fileName: safeFileName(envelope.fileName),
				mimeType: envelope.mimeType || "application/octet-stream",
				fileSize: envelope.fileSize,
				fileDataBase64,
				verified,
				verifyStatus,
			});
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
			if (!isValidFingerprintBech32(fingerprint)) {
				throw new HttpError(STATUS.BadRequest, "fingerprint must be valid bech32");
			}

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

serve(handleRequest, { port: PORT, hostname: HOST });
console.log(`EBP GUI local backend listening on http://${HOST}:${PORT}`);

