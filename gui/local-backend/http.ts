import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";

export type JsonValue = Record<string, unknown>;

export const STATUS = {
	OK: 200,
	Created: 201,
	BadRequest: 400,
	Unauthorized: 401,
	Forbidden: 403,
	NotFound: 404,
	Conflict: 409,
	BadGateway: 502,
	InternalServerError: 500,
} as const;
export type StatusCode = (typeof STATUS)[keyof typeof STATUS];

export const VERSION_MAP = FILE_FORMAT_VERSIONS as Readonly<Record<string, number>>;
export const ENCRYPTED_FILE_FORMAT_VERSION = VERSION_MAP.encryptedFile ?? 1;
export const ENCRYPTED_SIGNED_FILE_FORMAT_VERSION = VERSION_MAP.encryptedSignedFile ?? 1;

// CORS allow-origin is intentionally NOT set here. It is applied per-request
// at the `handleRequest` boundary by security.ts::applyCorsHeaders so that
// only origins on the allow-list are echoed back (F-GUI-01). This base map
// advertises allowed headers and methods for preflight.
export const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, x-ebp-csrf",
	"access-control-allow-methods": "GET,POST,OPTIONS",
};

export const STATIC_ROOT = new URL("..", import.meta.url);

export class HttpError extends Error {
	status: StatusCode;
	details?: unknown;

	constructor(status: StatusCode, message: string, details?: unknown) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

export function contentType(pathname: string): string {
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

export async function tryServeStatic(req: Request, url: URL): Promise<Response | null> {
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

export function json(body: unknown, status: StatusCode = STATUS.OK): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			...CORS_HEADERS,
		},
	});
}

export async function readJson<T extends JsonValue>(req: Request): Promise<T> {
	try {
		return (await req.json()) as T;
	} catch {
		throw new HttpError(STATUS.BadRequest, "invalid json body");
	}
}

export function randomHex(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeFileName(fileName: string): string {
	const normalized = fileName.replace(/\\/g, "/");
	const base = normalized.split("/").pop() || "encrypted.bin";
	const withoutControl = Array.from(base).filter((ch) => {
		const code = ch.charCodeAt(0);
		return !(code <= 31 || code === 127);
	}).join("");
	return withoutControl.replace(/\.\./g, "_");
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}
