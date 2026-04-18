import { ImapFlow } from "imapflow";
import { extractArmoredPayload } from "../../core/Payloads.ts";
import type { MailAccountConfig, MailAuthSecrets } from "./mail-account.ts";

export function buildImapClient(config: MailAccountConfig, secrets: MailAuthSecrets): ImapFlow {
	const auth = config.authType === "oauth"
		? { user: config.username, accessToken: secrets.accessToken ?? "" }
		: { user: config.username, pass: secrets.imapPassword };
	const client = new ImapFlow({
		host: config.imapHost,
		port: config.imapPort,
		secure: config.imapSecure,
		auth,
		// Deno's node:zlib compatibility can intermittently fail with COMPRESS=DEFLATE on some providers.
		// Keep transport uncompressed for stability when fetching full message bodies.
		disableCompression: true,
		logger: false,
		// ImapFlow docs describe socketTimeout as inactivity timeout with a much higher default (300_000ms).
		// Keep close to upstream behavior; 20s is too aggressive and causes spurious NoConnection errors.
		socketTimeout: 300_000,
		greetingTimeout: 20_000,
	});
	// Some providers close TLS sockets without close_notify; don't let transport-level errors crash the process.
	client.on("error", (_err) => {
		// Swallow here; request handlers surface operation failures via caught await errors.
	});
	return client;
}

export function safeImapDisconnect(imap: ImapFlow): void {
	try {
		// LOGOUT can fail on already dropped sockets; close is safest for short-lived request-scoped clients.
		imap.close();
	} catch {
		// ignore
	}
}

export function isNoConnectionError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const e = err as { code?: unknown; message?: unknown; name?: unknown };
	if (e.code === "NoConnection") return true;
	if (e.name === "NoConnectionError") return true;
	const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
	return message.includes("connection not available");
}

export async function withImapReconnect<T>(
	config: MailAccountConfig,
	secrets: MailAuthSecrets,
	work: (imap: ImapFlow) => Promise<T>,
): Promise<T> {
	let lastErr: unknown = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const imap = buildImapClient(config, secrets);
		try {
			await imap.connect();
			return await work(imap);
		} catch (err) {
			lastErr = err;
			if (attempt === 0 && isNoConnectionError(err)) {
				continue;
			}
			throw err;
		} finally {
			safeImapDisconnect(imap);
		}
	}
	throw lastErr;
}

export async function withMailboxLock<T>(
	imap: ImapFlow,
	folder: string,
	work: () => Promise<T>,
): Promise<T> {
	// ImapFlow recommends getMailboxLock() over mailboxOpen() for safer transactional mailbox operations.
	const lock = await imap.getMailboxLock(folder, { readOnly: true });
	try {
		return await work();
	} finally {
		lock.release();
	}
}

export function getAddressText(addr: unknown): string {
	if (!Array.isArray(addr) || addr.length === 0) return "";
	const first = addr[0] as Record<string, unknown>;
	const name = typeof first.name === "string" ? first.name : "";
	const address = typeof first.address === "string" ? first.address : "";
	if (!name) return address;
	return `${name} <${address}>`;
}

export function getIdentityDetailValue(details: unknown, path: string): string | null {
	if (!details || typeof details !== "object") return null;
	const record = details as Record<string, unknown>;
	const raw = record[path];
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
	return null;
}

export function getIdentityDetailMeta(detailsMeta: unknown, path: string): Record<string, unknown> | null {
	if (!detailsMeta || typeof detailsMeta !== "object") return null;
	const raw = (detailsMeta as Record<string, unknown>)[path];
	if (!raw || typeof raw !== "object") return null;
	return raw as Record<string, unknown>;
}

export function extractEmailAddress(value: string): string {
	const text = (value ?? "").trim();
	const angle = text.match(/<([^>]+)>/);
	const candidate = angle ? angle[1] : text;
	const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
	return match ? match[0].toLowerCase() : "";
}

export function extractEbpPayload(text: string): Record<string, unknown> | null {
	return extractArmoredPayload(text);
}
