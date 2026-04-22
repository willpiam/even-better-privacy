import { parseArgs } from "@std/cli/parse-args";
import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
	type CLIContext,
	ensureServer,
	apiUrl,
	loadIdentity,
	saveIdentity,
} from "../utils.ts";

export async function cmdAttachDetail(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity, password } = await loadIdentity(ctx, args["password"] as string | undefined);
	const path = args._[0] as string;
	const detail = args._[1] as string;
	const push = args["push"] ?? false;
	const opaque = args["opaque"] ?? false;
	
	if (!path || !detail) {
		console.error("Usage: ebp detail <path> <value>");
		console.error("Example: ebp detail name 'John Doe'");
		Deno.exit(1);
	}
	
	const effectivePath = opaque && !path.startsWith("opaque::") ? `opaque::${path}` : path;
	const detailToAttach = effectivePath.startsWith("opaque::") ? sha256Hex(detail) : detail;
	identity.attachDetail(effectivePath, detailToAttach);
	
	// Save in new format
	await saveIdentity(ctx, password, identity);
	console.log(`✓ Detail attached: ${effectivePath} = ${detailToAttach}`);

	if (push) {
		const server = ensureServer(ctx, args);
		const entry = identity.details.get(effectivePath);
		if (!entry) {
			console.error("Failed to locate attached detail for push.");
			Deno.exit(1);
		}
		const [detailValue, proof] = entry;

		const res = await fetch(apiUrl(server, "/api/v1/detail"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				fingerprint: identity.toFingerprint(),
				path: effectivePath,
				detail: detailValue,
				proof,
			}),
		});

		let body: unknown = {};
		try {
			body = await res.json();
		} catch {
			// ignore parse errors
		}

		if (!res.ok) {
			const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
			console.error(`✗ Failed to push detail to server: ${reason}`);
			Deno.exit(1);
		}

		console.log(`✓ Detail pushed to server ${server}`);
	}
}

export async function cmdRevokeDetail(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity, password } = await loadIdentity(ctx, args["password"] as string | undefined);
	const path = args._[0] as string;
	const reason = args["reason"] as string | undefined;
	const push = args["push"] ?? false;
	
	if (!path) {
		console.error("Usage: ebp revoke-detail <path> [--reason <reason>] [--push]");
		console.error("Example: ebp revoke-detail email --reason 'Changed email address'");
		Deno.exit(1);
	}

	if (!identity.details.has(path)) {
		console.error(`Detail not found: ${path}`);
		Deno.exit(1);
	}
	
	const certificate = identity.revokeDetail(path, reason);
	
	// Save changes
	await saveIdentity(ctx, password, identity);
	
	console.log(`✓ Detail revoked: ${path}`);
	if (reason) {
		console.log(`  Reason: ${reason}`);
	}

	if (push) {
		const server = ensureServer(ctx, args);

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

		let body: unknown = {};
		try {
			body = await res.json();
		} catch {
			// ignore parse errors
		}

		if (!res.ok) {
			const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
			console.error(`✗ Failed to push revocation to server: ${reason}`);
			Deno.exit(1);
		}

		console.log(`✓ Revocation pushed to server ${server}`);
	}
}

export async function cmdRevokeIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity, password } = await loadIdentity(ctx, args["password"] as string | undefined);
	const reason = args["reason"] as string | undefined;
	const push = args["push"] ?? false;
	const force = args["force"] ?? false;

	if (identity.isRevoked()) {
		console.error("Identity is already revoked.");
		Deno.exit(1);
	}

	if (!force) {
		console.log("WARNING: Revoking an identity is irreversible!");
		console.log("This will mark your identity as compromised/invalid.");
		console.log("Use --force to confirm this action.");
		Deno.exit(1);
	}
	
	const certificate = identity.createIdentityRevocation(reason);
	
	// Save changes
	await saveIdentity(ctx, password, identity);
	
	console.log(`✓ Identity revoked: ${identity.toFingerprint()}`);
	if (reason) {
		console.log(`  Reason: ${reason}`);
	}

	if (push) {
		const server = ensureServer(ctx, args);

		const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				fingerprint: identity.toFingerprint(),
				type: "identity",
				certificate,
			}),
		});

		let body: unknown = {};
		try {
			body = await res.json();
		} catch {
			// ignore parse errors
		}

		if (!res.ok) {
			const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
			console.error(`✗ Failed to push revocation to server: ${reason}`);
			Deno.exit(1);
		}

		console.log(`✓ Revocation pushed to server ${server}`);
	}
}

export async function cmdGenerateRevocationCert(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const output = args["output"] as string | undefined;

	const emergencyCert = identity.generateEmergencyRevocationCertificate();
	const certData = JSON.stringify({
		type: "ebp-emergency-revocation-certificate",
		version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
		fingerprint: identity.toFingerprint(),
		certificate: emergencyCert,
		createdAt: new Date().toISOString(),
		warning: "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
	}, null, 2);

	if (output) {
		// F-STORAGE-06: emergency revocation certificates are secret-equivalent;
		// write 0o600 regardless of the user-specified destination.
		await Deno.writeTextFile(output, certData, { mode: 0o600 });
		console.log(`✓ Emergency revocation certificate saved to: ${output}`);
	} else {
		console.log("⚠️  Emergency Revocation Certificate:");
		console.log("    Store this securely (e.g., print and keep in a safe).");
		console.log("    Anyone with this certificate can revoke your identity.\n");
		console.log(certData);
	}
}
