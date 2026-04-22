import { Identity, type IdentityPublicData } from "../../core/Identity.ts";
import { type CLIContext, ensurePrivateDir } from "../../cli/utils.ts";
import { HttpError, STATUS } from "./http.ts";

export async function loadIdentity(ctx: CLIContext, password: string): Promise<Identity> {
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
		identity = Identity.fromStorageFormat(storageData, password);
	} catch {
		throw new HttpError(STATUS.Unauthorized, "failed to decrypt identity (wrong password?)");
	}

	// F-STORAGE-02: transparent KDF upgrade on successful unlock.
	if (Identity.isStorageEncryptedWithLegacyKDF(storageData)) {
		try {
			await saveIdentity(ctx, password, identity);
		} catch (e) {
			console.warn("failed to upgrade identity KDF:", e);
		}
	}

	return identity;
}

/** Load only the public portion of an identity (no password required) */
export async function loadIdentityPublic(ctx: CLIContext): Promise<IdentityPublicData | null> {
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

export async function saveIdentity(ctx: CLIContext, password: string, identity: Identity): Promise<void> {
	const baseName = ctx.currentIdentity;
	const dir = ctx.identityDir;
	const newPath = `${dir}/${baseName}.identity.json`;

	await ensurePrivateDir(dir);
	const storageData = identity.toStorageFormat(password);
	await Deno.writeTextFile(newPath, storageData, { mode: 0o600 });
	console.log(`Saved identity to ${newPath}`);

	ctx.identityPath = newPath;
}

export function resolveServer(ctx: CLIContext, override?: string): string {
	const server = override ?? ctx.server;
	if (!server) throw new HttpError(STATUS.BadRequest, "server not configured");
	return server.replace(/\/+$/, "");
}

export function toSafeString(value: unknown, max = 512): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function clampPort(value: unknown, fallback: number): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
	return n;
}

export function asBool(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}
