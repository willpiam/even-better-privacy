import { ImapFlow } from "imapflow";
import { extractArmoredPayload } from "../../core/Payloads.ts";
import type { MailAccountConfig, MailAuthSecrets } from "./mail-account.ts";
import { HttpError, STATUS } from "./http.ts";

export function buildImapClient(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): ImapFlow {
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
  options?: { connectTimeoutMs?: number },
): Promise<T> {
  let lastErr: unknown = null;
  const connectTimeoutMs = options?.connectTimeoutMs ?? 10_000;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const imap = buildImapClient(config, secrets);
    try {
      await withTimeout(imap.connect(), connectTimeoutMs, "imap-connect");
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
  options?: { lockTimeoutMs?: number },
): Promise<T> {
  // ImapFlow recommends getMailboxLock() over mailboxOpen() for safer transactional mailbox operations.
  const lock = await withTimeout(
    imap.getMailboxLock(folder, { readOnly: true }),
    options?.lockTimeoutMs ?? 10_000,
    `mailbox-lock:${folder}`,
  );
  try {
    return await work();
  } finally {
    lock.release();
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timerId = setTimeout(() => {
          reject(
            new HttpError(STATUS.BadGateway, `mail step timed out: ${label}`),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timerId !== null) clearTimeout(timerId);
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

export function getIdentityDetailValue(
  details: unknown,
  path: string,
): string | null {
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;
  const raw = record[path];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return null;
}

export function getIdentityDetailMeta(
  detailsMeta: unknown,
  path: string,
): Record<string, unknown> | null {
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

export function extractEbpPayload(
  text: string,
): Record<string, unknown> | null {
  return extractArmoredPayload(text);
}

const MAX_MAIL_SOURCE_BYTES = Number(
  Deno.env.get("MAIL_PARSE_MAX_BYTES") ?? `${5 * 1024 * 1024}`,
);

function sourceToString(source: unknown): string {
  if (typeof source === "string") return source;
  if (source instanceof Uint8Array) {
    return new TextDecoder().decode(source);
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(source));
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(new Uint8Array(source.buffer));
  }
  return "";
}

export async function parseMailSourceInWorker(
  source: unknown,
  mode: "message" | "attachment",
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const sourceText = sourceToString(source);
  const sourceBytes = new TextEncoder().encode(sourceText).byteLength;
  if (!sourceText || sourceBytes === 0) {
    throw new HttpError(STATUS.BadRequest, "mail source is empty");
  }
  if (sourceBytes > MAX_MAIL_SOURCE_BYTES) {
    throw new HttpError(
      STATUS.BadRequest,
      `mail source exceeds parse limit (${MAX_MAIL_SOURCE_BYTES} bytes)`,
    );
  }
  const worker = new Worker(new URL("./mail-worker.ts", import.meta.url).href, {
    type: "module",
    deno: {
      permissions: {
        read: false,
        write: false,
        net: false,
        // mailparser/npm may probe these; deny all other env
        env: [
          "NODE_V8_COVERAGE",
          "NODE_DEBUG_NATIVE",
          "NODE_DISABLE_COMPILE_CACHE",
          "NODE_COMPILE_CACHE_PORTABLE",
          "NODE_COMPILE_CACHE",
        ],
        run: false,
        ffi: false,
      },
    },
  });
  try {
    return await withTimeout(
      new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<
            { ok: boolean; data?: Record<string, unknown>; error?: string }
          >,
        ) => {
          if (event.data.ok && event.data.data) {
            resolve(event.data.data);
          } else {
            reject(
              new HttpError(
                STATUS.BadGateway,
                event.data.error ?? "mail parse failed",
              ),
            );
          }
        };
        worker.onerror = (event) => {
          reject(
            new HttpError(
              STATUS.BadGateway,
              event.message || "mail parse worker crashed",
            ),
          );
        };
        worker.postMessage({ mode, source: sourceText });
      }),
      timeoutMs,
      `mail-parse-${mode}`,
    );
  } finally {
    worker.terminate();
  }
}
