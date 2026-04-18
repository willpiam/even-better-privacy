import {
	decodeHierarchyCertificate,
	isHierarchyCertificateExpired,
	type HierarchyCertificateData,
	type SignedHierarchyCertificate,
} from "../../core/HierarchyCertificate.ts";
import { hexToString, stringToHex } from "../../core/Hex.ts";
import { decodeFingerprintBech32 } from "../../core/Fingerprint.ts";
import { toHex } from "../../core/Hex.ts";
import type { CLIContext } from "../../cli/utils.ts";
import { ensureDir } from "../../cli/utils.ts";
import { HttpError, STATUS } from "./http.ts";

export type LocalPendingHierarchyProposal = {
	id: number;
	masterFingerprint: string;
	childFingerprint: string;
	proposerFingerprint: string;
	certificate: string;
	context: string;
	expiry: number;
	createdAt: number;
};

export function getHierarchyDir(ctx: CLIContext): string {
	return `${ctx.identityDir}/hierarchy`;
}

export function decodeHierarchyCertificateDraft(encoded: string): HierarchyCertificateData {
	try {
		const parsed = JSON.parse(hexToString(encoded)) as HierarchyCertificateData;
		if (!parsed || typeof parsed !== "object") {
			throw new Error("invalid hierarchy certificate");
		}
		if (typeof parsed.masterFingerprint !== "string" || typeof parsed.childFingerprint !== "string") {
			throw new Error("invalid hierarchy certificate fingerprints");
		}
		if (typeof parsed.timestamp !== "number" || typeof parsed.expiry !== "number") {
			throw new Error("invalid hierarchy certificate timestamps");
		}
		if (typeof parsed.context !== "string" || typeof parsed.salt !== "string") {
			throw new Error("invalid hierarchy certificate payload");
		}
		return parsed;
	} catch {
		throw new HttpError(STATUS.BadRequest, "invalid hierarchy certificate encoding");
	}
}

export async function listHierarchyCertificatesLocal(
	ctx: CLIContext,
): Promise<Array<{ certificate: string; decoded: SignedHierarchyCertificate }>> {
	const out: Array<{ certificate: string; decoded: SignedHierarchyCertificate }> = [];
	const dir = getHierarchyDir(ctx);
	try {
		for await (const entry of Deno.readDir(dir)) {
			if (!entry.isFile || !entry.name.endsWith(".json")) continue;
			const json = await Deno.readTextFile(`${dir}/${entry.name}`);
			const payload = JSON.parse(json) as { certificate?: string };
			if (!payload?.certificate || typeof payload.certificate !== "string") continue;
			const decoded = decodeHierarchyCertificate(payload.certificate);
			if (!decoded) continue;
			out.push({ certificate: payload.certificate, decoded });
		}
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return out;
		throw e;
	}
	return out;
}

export async function storeHierarchyCertificateLocal(ctx: CLIContext, encodedCertificate: string): Promise<void> {
	const decoded = decodeHierarchyCertificate(encodedCertificate);
	if (!decoded) {
		throw new HttpError(STATUS.BadRequest, "hierarchy certificate must include both signatures");
	}
	await ensureDir(getHierarchyDir(ctx));
	const path = `${getHierarchyDir(ctx)}/${decoded.childFingerprint}.json`;
	await Deno.writeTextFile(path, JSON.stringify({ certificate: encodedCertificate }, null, 2));
}

export function getPendingHierarchyPath(ctx: CLIContext): string {
	return `${ctx.identityDir}/hierarchy-pending.json`;
}

export async function readPendingHierarchyLocal(ctx: CLIContext): Promise<LocalPendingHierarchyProposal[]> {
	try {
		const raw = await Deno.readTextFile(getPendingHierarchyPath(ctx));
		const parsed = JSON.parse(raw) as LocalPendingHierarchyProposal[];
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((p) =>
			p && typeof p.id === "number" && typeof p.masterFingerprint === "string" && typeof p.childFingerprint === "string"
		);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return [];
		throw e;
	}
}

export async function writePendingHierarchyLocal(ctx: CLIContext, proposals: LocalPendingHierarchyProposal[]): Promise<void> {
	await ensureDir(ctx.identityDir);
	await Deno.writeTextFile(getPendingHierarchyPath(ctx), JSON.stringify(proposals, null, 2));
}

export async function addPendingHierarchyLocal(
	ctx: CLIContext,
	record: Omit<LocalPendingHierarchyProposal, "id" | "createdAt">,
): Promise<LocalPendingHierarchyProposal> {
	const all = await readPendingHierarchyLocal(ctx);
	const duplicate = all.find((p) => p.masterFingerprint === record.masterFingerprint && p.childFingerprint === record.childFingerprint);
	if (duplicate) {
		throw new HttpError(STATUS.Conflict, "a pending proposal for this relationship already exists");
	}
	const nextId = all.reduce((max, item) => Math.max(max, item.id), 0) + 1;
	const proposal: LocalPendingHierarchyProposal = {
		id: nextId,
		createdAt: Date.now(),
		...record,
	};
	all.push(proposal);
	await writePendingHierarchyLocal(ctx, all);
	return proposal;
}

export function buildHierarchyTreeFromCertificates(
	fingerprint: string,
	certs: SignedHierarchyCertificate[],
): {
	fingerprint: string;
	root: string;
	ancestors: string[];
	descendants: string[];
	allFingerprints: string[];
	relationships: Array<{
		masterFingerprint: string;
		childFingerprint: string;
		timestamp: number;
		expiry: number;
		context: string;
		certificate: string;
		expired: boolean;
	}>;
} {
	const childToParent = new Map<string, SignedHierarchyCertificate>();
	const masterToChildren = new Map<string, SignedHierarchyCertificate[]>();
	for (const cert of certs) {
		childToParent.set(cert.childFingerprint, cert);
		const arr = masterToChildren.get(cert.masterFingerprint) ?? [];
		arr.push(cert);
		masterToChildren.set(cert.masterFingerprint, arr);
	}

	const ancestors: string[] = [];
	let root = fingerprint;
	while (true) {
		const parent = childToParent.get(root);
		if (!parent) break;
		ancestors.push(parent.masterFingerprint);
		root = parent.masterFingerprint;
	}

	const descendants: string[] = [];
	const relationships: Array<{
		masterFingerprint: string;
		childFingerprint: string;
		timestamp: number;
		expiry: number;
		context: string;
		certificate: string;
		expired: boolean;
	}> = [];
	const queue = [root];
	const seen = new Set<string>([root]);
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const edge of masterToChildren.get(current) ?? []) {
			const encoded = stringToHex(JSON.stringify(edge));
			relationships.push({
				masterFingerprint: edge.masterFingerprint,
				childFingerprint: edge.childFingerprint,
				timestamp: edge.timestamp,
				expiry: edge.expiry,
				context: edge.context,
				certificate: encoded,
				expired: isHierarchyCertificateExpired({ expiry: edge.expiry }),
			});
			descendants.push(edge.childFingerprint);
			if (!seen.has(edge.childFingerprint)) {
				seen.add(edge.childFingerprint);
				queue.push(edge.childFingerprint);
			}
		}
	}

	return {
		fingerprint,
		root,
		ancestors,
		descendants,
		allFingerprints: Array.from(new Set([fingerprint, root, ...ancestors, ...descendants])),
		relationships,
	};
}

export function fingerprintColor(fp: string): string {
	try {
		const decoded = decodeFingerprintBech32(fp);
		const bytes = decoded.bytes;
		const last3 = bytes.slice(bytes.length - 3);
		return "#" + toHex(last3);
	} catch {
		return "#58a6ff";
	}
}
