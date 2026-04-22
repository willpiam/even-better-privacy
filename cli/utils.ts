import { Identity, ExternalIdentity } from "../core/Identity.ts";
import {
	buildIdentityStateFromExternal,
	canonicalize,
	computeStateHash,
	type IdentityState,
	stableStringify,
} from "../core/StateHash.ts";

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

export type { IdentityState };

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
	await ensurePrivateDir(identityDir);
	await Deno.writeTextFile(`${identityDir}/state.json`, JSON.stringify(state, null, 2), { mode: 0o600 });
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

export async function ensureDir(path: string, options?: { mode?: number }): Promise<void> {
	try {
		await Deno.mkdir(path, { recursive: true, mode: options?.mode });
	} catch (e) {
		if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
	}
}

// Ensure a directory that must not be world-readable (identity/contacts/etc.
// dirs under ~/.ebp/). Creates the directory with mode 0o700 and tightens
// any pre-existing permissions. No-op for the mode on Windows. See F-STORAGE-04.
export async function ensurePrivateDir(path: string): Promise<void> {
	await ensureDir(path, { mode: 0o700 });
	if (Deno.build.os === "windows") return;
	try {
		await Deno.chmod(path, 0o700);
	} catch {
		// best-effort: some platforms (e.g. Windows, mounted volumes) may not
		// support chmod.
	}
}

// Recursively tighten permissions on an existing ~/.ebp/ tree. Used on
// startup to repair legacy installs that wrote identity files at mode 0o664
// and the directory at 0o775 (F-STORAGE-01/04).
export async function fixLegacyPerms(identityDir: string): Promise<void> {
	if (Deno.build.os === "windows") return;
	try {
		await Deno.chmod(identityDir, 0o700);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return;
		return;
	}
	try {
		for await (const entry of Deno.readDir(identityDir)) {
			const childPath = `${identityDir}/${entry.name}`;
			if (entry.isFile) {
				try { await Deno.chmod(childPath, 0o600); } catch { /* best-effort */ }
			} else if (entry.isDirectory) {
				await fixLegacyPerms(childPath);
			}
		}
	} catch {
		// best-effort
	}
}

// F-CLI-01: read a password from stdin without echoing it to the terminal.
//
// When stdin is a TTY, switch to raw mode (cbreak) so keystrokes are read
// individually without being echoed by the terminal driver. When stdin is
// not a TTY (e.g. a pipe under `deno test`), we fall back to an ordinary
// line-read so scripts and test harnesses still work.
export async function readPassword(prompt: string): Promise<string> {
	await Deno.stdout.write(new TextEncoder().encode(prompt));

	let rawSet = false;
	try {
		// setRaw is only valid on TTY stdin; throws otherwise.
		Deno.stdin.setRaw(true, { cbreak: true });
		rawSet = true;
	} catch {
		// not a TTY — fall through to buffered read path.
	}

	try {
		if (!rawSet) {
			const buf = new Uint8Array(1024);
			const n = await Deno.stdin.read(buf);
			if (n === null) throw new Error("Failed to read password");
			return new TextDecoder().decode(buf.subarray(0, n)).trim();
		}

		const decoder = new TextDecoder();
		const chunk = new Uint8Array(1);
		const chars: number[] = [];
		while (true) {
			const n = await Deno.stdin.read(chunk);
			if (n === null) break;
			const b = chunk[0];
			// CR, LF, EOT (Ctrl-D) — treat as end of input.
			if (b === 0x0d || b === 0x0a || b === 0x04) {
				break;
			}
			// Ctrl-C — propagate as a failed read rather than return partial.
			if (b === 0x03) {
				throw new Error("password read aborted");
			}
			// Backspace / DEL — pop one char.
			if (b === 0x7f || b === 0x08) {
				if (chars.length > 0) chars.pop();
				continue;
			}
			chars.push(b);
		}
		// Write a newline after the (silent) input so the next prompt is on
		// its own line.
		await Deno.stdout.write(new TextEncoder().encode("\n"));
		return decoder.decode(new Uint8Array(chars)).trim();
	} finally {
		if (rawSet) {
			try { Deno.stdin.setRaw(false); } catch { /* best-effort */ }
		}
	}
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

export { canonicalize, computeStateHash, stableStringify };

export function buildStateFromExternal(ext: ExternalIdentity, details: Record<string, [string, string]>): IdentityState {
	return buildIdentityStateFromExternal(ext, details);
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

export function randomHex(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function baseName(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/");
	return parts[parts.length - 1] || "encrypted.bin";
}

export function safeFileName(fileName: string): string {
	return baseName(fileName).replace(/[\u0000-\u001F\u007F]/g, "").replace(/\.\./g, "_");
}

export async function loadIdentity(ctx: CLIContext, password?: string): Promise<{ identity: Identity; password: string }> {
	let storageData: string;
	try {
		storageData = await Deno.readTextFile(ctx.identityPath);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			console.error("No identity found. Run 'generate' first.");
			Deno.exit(1);
		}
		throw e;
	}

	const pwd = password ?? await readPassword("Enter password: ");

	let identity: Identity;
	try {
		identity = Identity.fromStorageFormat(storageData, pwd);
	} catch {
		console.error("Failed to decrypt identity. Wrong password?");
		Deno.exit(1);
	}

	// F-STORAGE-02: transparent re-encrypt when a legacy-KDF blob is
	// successfully unlocked. We rewrite at the stronger parameters before
	// handing the identity back to the caller.
	if (Identity.isStorageEncryptedWithLegacyKDF(storageData)) {
		try {
			await saveIdentity(ctx, pwd, identity);
			console.error("[ebp] upgraded identity file KDF to the current strength.");
		} catch (e) {
			console.error("[ebp] warning: failed to upgrade identity KDF:", e);
		}
	}

	return { identity, password: pwd };
}

export async function saveIdentity(ctx: CLIContext, password: string, identity: Identity): Promise<void> {
	const baseName = ctx.currentIdentity;
	const dir = ctx.identityDir;
	const newPath = `${dir}/${baseName}.identity.json`;

	await ensurePrivateDir(dir);
	const storageData = identity.toStorageFormat(password);
	await Deno.writeTextFile(newPath, storageData, { mode: 0o600 });

	ctx.identityPath = newPath;
}

