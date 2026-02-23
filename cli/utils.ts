import { sha256 } from "@noble/hashes/sha2";
import { ExternalIdentity } from "../core/Identity.ts";

export interface CLIContext {
	identityDir: string;
	identityPath: string;
	contactsDir: string;
	currentIdentity: string;
	server?: string;
}

export interface CLIState {
	currentIdentity: string;
	server?: string;
}

export type IdentityState = {
	fingerprint: string;
	signingKeyType: string;
	encryptionKeyType: string;
	signingKey: string;
	encryptionKey: string;
	signingKeyDetails?: Record<string, unknown> | null;
	encryptionKeyDetails?: Record<string, unknown> | null;
	details: Record<string, [string, string]>;
};

const textEncoder = new TextEncoder();

export async function readState(identityDir: string): Promise<CLIState | undefined> {
	try {
		const json = await Deno.readTextFile(`${identityDir}/state.json`);
		return JSON.parse(json) as CLIState;
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return undefined;
		throw e;
	}
}

export async function writeState(identityDir: string, state: CLIState): Promise<void> {
	await ensureDir(identityDir);
	await Deno.writeTextFile(`${identityDir}/state.json`, JSON.stringify(state, null, 2));
}

export async function updateState(identityDir: string, updates: Partial<CLIState>): Promise<CLIState> {
	const existing = (await readState(identityDir)) ?? { currentIdentity: "identity" };
	const next = { ...existing, ...updates };
	await writeState(identityDir, next);
	return next;
}

export async function listIdentityNames(identityDir: string): Promise<string[]> {
	try {
		const entries = Deno.readDir(identityDir);
		const names: string[] = [];
		const seen = new Set<string>();
		for await (const entry of entries) {
			if (entry.isFile) {
				let name: string | null = null;
				if (entry.name.endsWith(".identity.json")) {
					name = entry.name.replace(".identity.json", "");
				}
				if (name && !seen.has(name)) {
					seen.add(name);
					names.push(name);
				}
			}
		}
		return names;
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return [];
		throw e;
	}
}

/** Get the identity file path, preferring new format if it exists */
export function getIdentityPath(identityDir: string, identityName: string): string {
	const newPath = `${identityDir}/${identityName}.identity.json`;
	return newPath;
}

export async function getContext(
	homeDir?: string,
	identityOverride?: string,
	serverOverride?: string,
): Promise<CLIContext> {
	const base = resolveBaseDir(homeDir);
	const identityDir = `${base}/.ebp`;
	const state = await readState(identityDir);
	const currentIdentity = identityOverride ?? state?.currentIdentity ?? "identity";
	const server = serverOverride ?? state?.server;
	const identityPath = await getIdentityPath(identityDir, currentIdentity);
	return {
		identityDir,
		identityPath,
		contactsDir: `${identityDir}/contacts`,
		currentIdentity,
		server,
	};
}

function resolveBaseDir(homeDir?: string): string {
	if (homeDir) return homeDir;

	const home = Deno.env.get("HOME");
	if (home && home.trim().length > 0) return home;

	const userProfile = Deno.env.get("USERPROFILE");
	if (userProfile && userProfile.trim().length > 0) return userProfile;

	const homeDrive = Deno.env.get("HOMEDRIVE");
	const homePath = Deno.env.get("HOMEPATH");
	if (homeDrive && homePath) return `${homeDrive}${homePath}`;

	return ".";
}

export async function ensureDir(path: string): Promise<void> {
	try {
		await Deno.mkdir(path, { recursive: true });
	} catch (e) {
		if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
	}
}

export async function readPassword(prompt: string): Promise<string> {
	const buf = new Uint8Array(1024);
	await Deno.stdout.write(new TextEncoder().encode(prompt));
	const n = await Deno.stdin.read(buf);
	if (n === null) throw new Error("Failed to read password");
	return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

export async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	const reader = Deno.stdin.readable.getReader();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}

	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return new TextDecoder().decode(result).trim();
}

export function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((v) => canonicalize(v));
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
		const out: Record<string, unknown> = {};
		for (const [k, v] of entries) {
			out[k] = canonicalize(v);
		}
		return out;
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function computeStateHash(state: IdentityState): string {
	const canonical = canonicalize(state);
	const data = textEncoder.encode(JSON.stringify(canonical));
	return toHex(sha256(data));
}

export function buildStateFromExternal(ext: ExternalIdentity, details: Record<string, [string, string]>): IdentityState {
	return {
		fingerprint: ext.fingerprint,
		signingKeyType: ext.signingKeyType,
		encryptionKeyType: ext.encryptionKeyType,
		signingKey: ext.signingKey,
		encryptionKey: ext.encryptionKey,
		signingKeyDetails: ext.signingKeyDetails ?? null,
		encryptionKeyDetails: ext.encryptionKeyDetails ?? null,
		details,
	};
}

export type ParsedArgs = Record<string, unknown> & { [key: string]: unknown };

export function ensureServer(ctx: CLIContext, args: ParsedArgs): string {
	const override = args["server"] as string | undefined;
	const server = override ?? ctx.server;
	if (!server) {
		console.error("No server configured. Set one with: ebp server <url> (or pass --server <url>)");
		Deno.exit(1);
	}
	return server.replace(/\/+$/, "");
}

export function apiUrl(server: string, path: string): string {
	const base = server.replace(/\/+$/, "");
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${base}${suffix}`;
}

