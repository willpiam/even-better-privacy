#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { parseArgs } from "@std/cli/parse-args";
import { Identity, ExternalIdentity } from "../core/Identity.ts";
import { PROTOCOL_VERSION, COMPONENT_VERSIONS, FILE_FORMAT_VERSIONS } from "../core/version.ts";
import { sha256Hex } from "../core/MessageHash.ts";
import {
	CLIContext,
	updateState,
	listIdentityNames,
	readState,
	getContext,
	getIdentityPath,
	ensureDir,
	readPassword,
	readStdin,
	computeStateHash,
	buildStateFromExternal,
	stableStringify,
	ensureServer,
	apiUrl,
} from "./utils.ts";

// ============================================================================
// Commands
// ============================================================================

function randomHex(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cmdGenerate(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const identityName = (args._[0] as string | undefined) ?? ctx.currentIdentity;
	const newFormatPath = `${ctx.identityDir}/${identityName}.identity.json`;
	const signingType = (args["signing"] as string) ?? "dilithium";
	const encryptionType = (args["encryption"] as string) ?? "kyber";
	const force = args["force"] ?? false;
	const generateRevocationCert = args["revocation-cert"] ?? false;
	const revocationOutput = args["revocation-output"] as string | undefined;

	// Check if identity already exists
	let exists = false;
	try {
		await Deno.stat(newFormatPath);
		exists = true;
	} catch (e) {
		if (!(e instanceof Deno.errors.NotFound)) throw e;
	}
	if (exists && !force) {
		console.error("Identity already exists. Use --force to overwrite.");
		Deno.exit(1);
	}

	// Validate key types
	if (!["dilithium", "sphincs"].includes(signingType)) {
		console.error(`Invalid signing key type: ${signingType}. Use 'dilithium' or 'sphincs'.`);
		Deno.exit(1);
	}
	if (encryptionType !== "kyber") {
		console.error(`Invalid encryption key type: ${encryptionType}. Only 'kyber' is supported.`);
		Deno.exit(1);
	}

	console.log(`Generating identity with ${signingType} signing and ${encryptionType} encryption...`);
	const identity = new Identity(
		signingType as "dilithium" | "sphincs",
		encryptionType as "kyber"
	);

	// Get password for encryption
	const password = await readPassword("Enter password to protect your identity: ");
	const confirmPassword = await readPassword("Confirm password: ");
	
	if (password !== confirmPassword) {
		console.error("Passwords do not match.");
		Deno.exit(1);
	}

	if (password.length < 8) {
		console.error("Password must be at least 8 characters.");
		Deno.exit(1);
	}

	// Create directories and save in new format
	await ensureDir(ctx.identityDir);
	await ensureDir(ctx.contactsDir);
	
	const storageData = await identity.toStorageFormat(password);
	await Deno.writeTextFile(newFormatPath, storageData);
	await updateState(ctx.identityDir, { currentIdentity: identityName });

	console.log("\n✓ Identity generated successfully!");
	console.log(`  Fingerprint: ${identity.toFingerprint()}`);
	console.log(`  Stored at: ${newFormatPath}`);
	console.log(`  Current identity set to: ${identityName}`);

	// Generate emergency revocation certificate if requested
	if (generateRevocationCert) {
		const emergencyCert = identity.generateEmergencyRevocationCertificate();
		const certData = JSON.stringify({
			type: "ebp-emergency-revocation-certificate",
			version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
			fingerprint: identity.toFingerprint(),
			certificate: emergencyCert,
			createdAt: new Date().toISOString(),
			warning: "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
		}, null, 2);

		if (revocationOutput) {
			await Deno.writeTextFile(revocationOutput, certData);
			console.log(`\n⚠️  Emergency revocation certificate saved to: ${revocationOutput}`);
		} else {
			console.log("\n⚠️  Emergency Revocation Certificate:");
			console.log("    Store this securely (e.g., print and keep in a safe).");
			console.log("    Anyone with this certificate can revoke your identity.\n");
			console.log(certData);
		}
	}
}

async function loadIdentity(ctx: CLIContext, password?: string): Promise<{ identity: Identity; password: string }> {
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
	
	try {
		const identity = await Identity.fromStorageFormat(storageData, pwd);
		return { identity, password: pwd };
	} catch {
		console.error("Failed to decrypt identity. Wrong password?");
		Deno.exit(1);
	}
}

async function saveIdentity(ctx: CLIContext, password: string, identity: Identity): Promise<void> {
	const baseName = ctx.currentIdentity;
	const dir = ctx.identityDir;
	const newPath = `${dir}/${baseName}.identity.json`;
	
	// Save in new format
	const storageData = await identity.toStorageFormat(password);
	await Deno.writeTextFile(newPath, storageData);
	
	// Update context path to new format
	ctx.identityPath = newPath;
}

async function cmdInfo(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	
	console.log("Identity Information:");
	console.log(`  Fingerprint: ${identity.toFingerprint()}`);
	console.log(`  Signing Key Type: ${identity.signingKeyType}`);
	console.log(`  Encryption Key Type: ${identity.encryptionKeyType}`);
	console.log(`  Protocol Version: ${PROTOCOL_VERSION}`);
	
	if (identity.details.size > 0) {
		console.log("\n  Details:");
		for (const [path, [detail]] of identity.details) {
			console.log(`    ${path}: ${detail}`);
		}
	}
}

async function cmdExportPublic(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const output = args["output"] as string | undefined;
	
	const external = identity.summary;
	const json = JSON.stringify(external, null, 2);
	
	if (output) {
		await Deno.writeTextFile(output, json);
		console.error(`Public key exported to: ${output}`);
	} else {
		console.log(json);
	}
}

async function cmdImportContact(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const inputFile = args._[0] as string | undefined;
	const name = args["name"] as string | undefined;
	
	let json: string;
	if (inputFile) {
		json = await Deno.readTextFile(inputFile);
	} else {
		json = await readStdin();
	}
	
	let external: ExternalIdentity;
	try {
		external = JSON.parse(json) as ExternalIdentity;
	} catch {
		console.error("Invalid JSON format.");
		Deno.exit(1);
	}
	
	// Validate required fields
	if (!external.fingerprint || !external.signingKey || !external.encryptionKey) {
		console.error("Invalid external identity: missing required fields.");
		Deno.exit(1);
	}
	
	await ensureDir(ctx.contactsDir);
	
	const contactName = name ?? external.fingerprint.substring(0, 16);
	const contactPath = `${ctx.contactsDir}/${contactName}.json`;
	
	await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2));
	console.log(`✓ Contact imported: ${contactName}`);
	console.log(`  Fingerprint: ${external.fingerprint}`);
}

async function cmdListContacts(_args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	try {
		const entries = Deno.readDir(ctx.contactsDir);
		let count = 0;
		
		console.log("Contacts:");
		for await (const entry of entries) {
			if (entry.isFile && entry.name.endsWith(".json")) {
				const contactPath = `${ctx.contactsDir}/${entry.name}`;
				const json = await Deno.readTextFile(contactPath);
				const contact = JSON.parse(json) as ExternalIdentity;
				const name = entry.name.replace(".json", "");
				console.log(`  ${name}`);
				console.log(`    Fingerprint: ${contact.fingerprint}`);
				console.log(`    Signing: ${contact.signingKeyType}, Encryption: ${contact.encryptionKeyType}`);
				count++;
			}
		}
		
		if (count === 0) {
			console.log("  (no contacts)");
		}
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			console.log("Contacts:");
			console.log("  (no contacts)");
		} else {
			throw e;
		}
	}
}

async function cmdListIdentities(ctx: CLIContext): Promise<void> {
	const names = await listIdentityNames(ctx.identityDir);
	const state = await readState(ctx.identityDir);
	const current = state?.currentIdentity ?? ctx.currentIdentity;
	
	console.log("Identities:");
	if (names.length === 0) {
		console.log("  (none)");
		return;
	}
	
	for (const name of names) {
		const marker = name === current ? " (current)" : "";
		console.log(`  ${name}${marker}`);
	}
}

async function cmdUseIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const target = args._[0] as string | undefined;
	if (!target) {
		console.error("Usage: ebp use <identity>");
		Deno.exit(1);
	}
	
	// Check identity path
	const targetPath = await getIdentityPath(ctx.identityDir, target);
	try {
		await Deno.stat(targetPath);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			console.error(`Identity not found: ${target}`);
			Deno.exit(1);
		}
		throw e;
	}
	
	await updateState(ctx.identityDir, { currentIdentity: target });
	console.log(`✓ Switched to identity: ${target}`);
}

async function cmdShowDetails(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	
	console.log(`Identity: ${ctx.currentIdentity}`);
	console.log(`  Fingerprint: ${identity.toFingerprint()}`);
	console.log(`  Signing Key Type: ${identity.signingKeyType}`);
	console.log(`  Encryption Key Type: ${identity.encryptionKeyType}`);
	console.log(`  Protocol Version: ${PROTOCOL_VERSION}`);
	
	console.log("\nDetails:");
	if (identity.details.size === 0) {
		console.log("  (none)");
		return;
	}
	
	for (const [path, [detail]] of identity.details) {
		console.log(`  ${path}: ${detail}`);
	}
}

async function loadContact(ctx: CLIContext, nameOrFingerprint: string): Promise<ExternalIdentity> {
	// Try by name first
	const byName = `${ctx.contactsDir}/${nameOrFingerprint}.json`;
	try {
		const json = await Deno.readTextFile(byName);
		return JSON.parse(json) as ExternalIdentity;
	} catch {
		// Try to find by fingerprint prefix
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
		} catch {
			// Contacts dir doesn't exist
		}
	}
	
	console.error(`Contact not found: ${nameOrFingerprint}`);
	Deno.exit(1);
}

async function cmdSign(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const inputFile = args._[0] as string | undefined;
	const outputFile = args["output"] as string | undefined;
	const detached = args["detached"] ?? false;
	const includeSalt = args["no-salt"] ? false : true;
	
	let message: string;
	if (inputFile) {
		message = await Deno.readTextFile(inputFile);
	} else {
		message = await readStdin();
	}
	
	const salt = includeSalt ? randomHex(16) : "";
	const messageHash = sha256Hex(message);
	const signature = identity.signMessage(message, salt);
	
	if (detached) {
		// Output just the signature
		const output = JSON.stringify({
			type: "ebp-signature",
			version: FILE_FORMAT_VERSIONS.signature,
			fingerprint: identity.toFingerprint(),
			messageHash,
			salt,
			signature,
		}, null, 2);
		
		if (outputFile) {
			await Deno.writeTextFile(outputFile, output);
			console.error(`Signature written to: ${outputFile}`);
		} else {
			console.log(output);
		}
	} else {
		// Output message + signature together
		const output = JSON.stringify({
			type: "ebp-signed-message",
			version: FILE_FORMAT_VERSIONS.signedMessage,
			fingerprint: identity.toFingerprint(),
			message,
			messageHash,
			salt,
			signature,
		}, null, 2);
		
		if (outputFile) {
			await Deno.writeTextFile(outputFile, output);
			console.error(`Signed message written to: ${outputFile}`);
		} else {
			console.log(output);
		}
	}
}

async function cmdVerify(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const inputFile = args._[0] as string | undefined;
	const sigFile = args["signature"] as string | undefined;
	const senderName = args["sender"] as string | undefined;
	
	let input: string;
	if (inputFile) {
		input = await Deno.readTextFile(inputFile);
	} else {
		input = await readStdin();
	}
	
	let message: string;
	let signature: string;
	let fingerprint: string;
	let messageHash: string;
	let salt = "";
	
	if (sigFile) {
		// Detached signature mode
		message = input;
		const sigJson = await Deno.readTextFile(sigFile);
		const sigData = JSON.parse(sigJson);
		if (sigData.type !== "ebp-signature") {
			console.error("Invalid signature file format.");
			Deno.exit(1);
		}
		signature = sigData.signature;
		fingerprint = sigData.fingerprint;
		messageHash = sigData.messageHash;
		salt = typeof sigData.salt === "string" ? sigData.salt : "";
	} else {
		// Combined message + signature
		const data = JSON.parse(input);
		if (data.type !== "ebp-signed-message") {
			console.error("Invalid signed message format.");
			Deno.exit(1);
		}
		message = data.message;
		signature = data.signature;
		fingerprint = data.fingerprint;
		messageHash = data.messageHash;
		salt = typeof data.salt === "string" ? data.salt : "";
	}

	if (typeof messageHash !== "string" || !/^[0-9a-f]{64}$/i.test(messageHash)) {
		console.error("Invalid or missing messageHash.");
		Deno.exit(1);
	}
	if (sha256Hex(message) !== messageHash) {
		console.error("Message hash mismatch.");
		Deno.exit(1);
	}
	
	// Find the sender
	let sender: ExternalIdentity;
	if (senderName) {
		sender = await loadContact(ctx, senderName);
	} else {
		// Try to find by fingerprint
		sender = await loadContact(ctx, fingerprint.substring(0, 16));
	}
	
	// Verify fingerprint matches
	if (sender.fingerprint !== fingerprint) {
		console.error(`Warning: Fingerprint mismatch!`);
		console.error(`  Expected: ${sender.fingerprint}`);
		console.error(`  Got: ${fingerprint}`);
	}
	
	const verified = Identity.VerifySignature(sender, message, signature, salt);
	
	if (verified) {
		console.error("✓ Signature verified!");
		console.log(message);
	} else {
		console.error("✗ Signature verification FAILED!");
		Deno.exit(1);
	}
}

async function cmdEncrypt(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const recipientName = args["recipient"] as string;
	const inputFile = args._[0] as string | undefined;
	const outputFile = args["output"] as string | undefined;
	const sign = args["sign"] ?? false;
	
	if (!recipientName) {
		console.error("Recipient required. Use --recipient <name>");
		Deno.exit(1);
	}
	
	const recipient = await loadContact(ctx, recipientName);
	
	let message: string;
	if (inputFile) {
		message = await Deno.readTextFile(inputFile);
	} else {
		message = await readStdin();
	}
	
	let output: string;
	let senderFingerprint: string | undefined;
	
	if (sign) {
		const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
		const ciphertext = identity.signAndEncryptFor(message, recipient);
		senderFingerprint = identity.toFingerprint();
		
		output = JSON.stringify({
			type: "ebp-encrypted-signed-message",
			version: FILE_FORMAT_VERSIONS.encryptedSignedMessage,
			recipientFingerprint: recipient.fingerprint,
			senderFingerprint,
			ciphertext,
		}, null, 2);
	} else {
		const ciphertext = Identity.EncryptFor(recipient, message);
		
		output = JSON.stringify({
			type: "ebp-encrypted-message",
			version: FILE_FORMAT_VERSIONS.encryptedMessage,
			recipientFingerprint: recipient.fingerprint,
			ciphertext,
		}, null, 2);
	}
	
	if (outputFile) {
		await Deno.writeTextFile(outputFile, output);
		console.error(`Encrypted message written to: ${outputFile}`);
	} else {
		console.log(output);
	}
}

async function cmdDecrypt(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const inputFile = args._[0] as string | undefined;
	const senderName = args["sender"] as string | undefined;
	
	let input: string;
	if (inputFile) {
		input = await Deno.readTextFile(inputFile);
	} else {
		input = await readStdin();
	}
	
	const data = JSON.parse(input);
	
	if (data.type === "ebp-encrypted-message") {
		// Unsigned encrypted message
		const message = identity.encryptionKey.decrypt(data.ciphertext);
		console.error("✓ Decrypted (unsigned - sender unknown)");
		console.log(message);
	} else if (data.type === "ebp-encrypted-signed-message") {
		// Signed encrypted message - need sender to verify
		let sender: ExternalIdentity;
		if (senderName) {
			sender = await loadContact(ctx, senderName);
		} else if (data.senderFingerprint) {
			sender = await loadContact(ctx, data.senderFingerprint.substring(0, 16));
		} else {
			console.error("Sender required to verify signature. Use --sender <name>");
			Deno.exit(1);
		}
		
		const result = identity.decryptAndVerify(data.ciphertext, sender);
		
		if (result.verified) {
			console.error("✓ Decrypted and verified!");
		} else {
			console.error("✗ Decrypted but signature verification FAILED!");
		}
		console.log(result.message);
	} else {
		console.error(`Unknown message type: ${data.type}`);
		Deno.exit(1);
	}
}

async function cmdAttachDetail(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity, password } = await loadIdentity(ctx, args["password"] as string | undefined);
	const path = args._[0] as string;
	const detail = args._[1] as string;
	const push = args["push"] ?? false;
	
	if (!path || !detail) {
		console.error("Usage: ebp detail <path> <value>");
		console.error("Example: ebp detail name 'John Doe'");
		Deno.exit(1);
	}
	
	identity.attachDetail(path, detail);
	
	// Save in new format
	await saveIdentity(ctx, password, identity);
	console.log(`✓ Detail attached: ${path} = ${detail}`);

	if (push) {
		const server = ensureServer(ctx, args);
		const entry = identity.details.get(path);
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
				path,
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

async function cmdRevokeDetail(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

async function cmdRevokeIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

async function cmdGenerateRevocationCert(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
		await Deno.writeTextFile(output, certData);
		console.log(`✓ Emergency revocation certificate saved to: ${output}`);
	} else {
		console.log("⚠️  Emergency Revocation Certificate:");
		console.log("    Store this securely (e.g., print and keep in a safe).");
		console.log("    Anyone with this certificate can revoke your identity.\n");
		console.log(certData);
	}
}

async function cmdPublishIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const server = ensureServer(ctx, args);
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const summary = identity.summary;

	// Fetch current server state (if any)
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
			const reason = body?.error ?? `HTTP ${res.status}`;
			console.error(`✗ Failed to query server identity: ${reason}`);
			Deno.exit(1);
		}
	} catch (e) {
		console.error(`✗ Failed to query server identity: ${e instanceof Error ? e.message : String(e)}`);
		Deno.exit(1);
	}

	// Ensure keys match if identity already exists
	if (serverIdentity) {
		if (
			serverIdentity.signingKey !== summary.signingKey ||
			serverIdentity.encryptionKey !== summary.encryptionKey ||
			serverIdentity.signingKeyType !== summary.signingKeyType ||
			serverIdentity.encryptionKeyType !== summary.encryptionKeyType
		) {
			console.error("Server identity keys differ from local identity; refusing to publish.");
			Deno.exit(1);
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

	let body: unknown = {};
	try {
		body = await res.json();
	} catch {
		// ignore parse errors
	}

	if (!res.ok) {
		const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
		console.error(`✗ Failed to publish identity: ${reason}`);
		Deno.exit(1);
	}

	const fp = (body as { fingerprint?: string } | undefined)?.fingerprint ?? summary.fingerprint;
	console.log(`✓ Identity published to ${server}`);
	console.log(`  Fingerprint: ${fp}`);
}

async function cmdFetchIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const server = ensureServer(ctx, args);
	const fingerprint = args._[0] as string | undefined;
	if (!fingerprint) {
		console.error("Usage: ebp fetch <fingerprint>");
		Deno.exit(1);
	}
	const name = args["name"] as string | undefined;

	const res = await fetch(apiUrl(server, `/api/v1/identity/${fingerprint}`));
	let body: unknown = {};
	try {
		body = await res.json();
	} catch {
		// ignore
	}

	if (!res.ok) {
		const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
		console.error(`✗ Failed to fetch identity: ${reason}`);
		Deno.exit(1);
	}

	const b = body as {
		fingerprint?: string;
		signingKeyType?: string;
		encryptionKeyType?: string;
		signingKey?: string;
		encryptionKey?: string;
		signingKeyDetails?: unknown;
		encryptionKeyDetails?: unknown;
		details?: Record<string, [string, string]>;
	} | undefined;

	if (b?.fingerprint && b.fingerprint !== fingerprint) {
		console.error("Warning: server fingerprint mismatch; storing as returned value.");
	}

	if (b?.signingKeyType !== "dilithium" && b?.signingKeyType !== "sphincs") {
		console.error("Invalid identity payload from server: signingKeyType");
		Deno.exit(1);
	}
	if (b?.encryptionKeyType !== "kyber") {
		console.error("Invalid identity payload from server: encryptionKeyType");
		Deno.exit(1);
	}

	const external: ExternalIdentity = {
		fingerprint: b?.fingerprint ?? fingerprint,
		signingKeyType: b?.signingKeyType ?? "dilithium",
		encryptionKeyType: b?.encryptionKeyType ?? "kyber",
		signingKey: b?.signingKey ?? "",
		encryptionKey: b?.encryptionKey ?? "",
		signingKeyDetails: b?.signingKeyDetails,
		encryptionKeyDetails: b?.encryptionKeyDetails,
		details: b?.details ?? {},
	};

	if (!external.signingKey || !external.encryptionKey) {
		console.error("Invalid identity payload from server.");
		Deno.exit(1);
	}

	await ensureDir(ctx.contactsDir);
	const contactName = name ?? external.fingerprint.substring(0, 16);
	const contactPath = `${ctx.contactsDir}/${contactName}.json`;
	await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2));

	console.log(`✓ Contact fetched from server ${server}`);
	console.log(`  Stored as: ${contactName}`);
	console.log(`  Fingerprint: ${external.fingerprint}`);
}

type ServerIdentityEntry = {
	fingerprint: string;
	signingKeyType?: string;
	encryptionKeyType?: string;
	createdAt?: number;
	details?: Record<string, [string, string] | string>;
};

function asServerEntry(value: unknown): ServerIdentityEntry | undefined {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	const fingerprint = typeof obj.fingerprint === "string" ? obj.fingerprint : undefined;
	if (!fingerprint) return undefined;
	const signingKeyType = typeof obj.signingKeyType === "string" ? obj.signingKeyType : undefined;
	const encryptionKeyType = typeof obj.encryptionKeyType === "string" ? obj.encryptionKeyType : undefined;
	const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : undefined;

	let details: Record<string, [string, string] | string> | undefined;
	if (obj.details && typeof obj.details === "object") {
		details = {};
		for (const [k, v] of Object.entries(obj.details as Record<string, unknown>)) {
			if (Array.isArray(v) && typeof v[0] === "string") {
				details[k] = [v[0], typeof v[1] === "string" ? v[1] : ""];
			} else if (typeof v === "string") {
				details[k] = v;
			}
		}
	}

	return { fingerprint, signingKeyType, encryptionKeyType, createdAt, details };
}

async function cmdListServerIdentities(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const server = ensureServer(ctx, args);
	const page = Math.max(1, parseInt(args["page"] as string, 10) || 1);
	const search = typeof args["search"] === "string" ? args["search"].trim() : undefined;

	const url = new URL(apiUrl(server, search ? "/api/v1/identities/search" : "/api/v1/identities"));
	url.searchParams.set("page", String(page));
	if (search) {
		url.searchParams.set("query", search);
	}

	const res = await fetch(url.toString());
	let body: unknown = {};
	try {
		body = await res.json();
	} catch {
		// ignore parse errors
	}

	if (!res.ok) {
		const reason = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
		console.error(`✗ Failed to list server identities: ${reason}`);
		Deno.exit(1);
	}

	const entriesRaw = (body as { identities?: unknown[] } | undefined)?.identities;
	if (!Array.isArray(entriesRaw)) {
		console.error("Invalid response from server.");
		Deno.exit(1);
	}
	const entries: ServerIdentityEntry[] = entriesRaw.map((v) => asServerEntry(v)).filter((v): v is ServerIdentityEntry => !!v);

	// Extract pagination info
	const pagination = (body as { pagination?: { page?: number; totalPages?: number; total?: number; hasMore?: boolean } } | undefined)?.pagination;
	const currentPage = pagination?.page ?? page;
	const totalPages = pagination?.totalPages ?? 1;
	const total = pagination?.total ?? entries.length;

	const searchInfo = search ? ` matching "${search}"` : "";
	console.log(`Identities on server ${server}${searchInfo} (page ${currentPage}/${totalPages}, ${total} total):`);
	if (entries.length === 0) {
		console.log("  (none on this page)");
		return;
	}

	const line = "-".repeat(60);
	entries.forEach((entry, idx) => {
		if (idx > 0) console.log(line);
		const fingerprint = entry.fingerprint ?? "(missing)";
		const signing = entry.signingKeyType ?? "?";
		const encryption = entry.encryptionKeyType ?? "?";
		const createdAt = entry.createdAt;
		const created = typeof createdAt === "number" ? new Date(createdAt).toISOString() : "unknown";

		console.log(`Fingerprint: ${fingerprint}`);
		console.log(`Signing/Encryption: ${signing}/${encryption}`);
		console.log(`Created: ${created}`);

		const details = entry.details ?? {};
		const detailEntries = Object.entries(details);
		console.log("Details:");
		if (detailEntries.length === 0) {
			console.log("  (none)");
		} else {
			console.log("  Path                     | Value");
			console.log("  ------------------------ | --------------------------------");
			for (const [path, value] of detailEntries) {
				const detailValue = Array.isArray(value) ? value[0] : value;
				const safeValue = typeof detailValue === "string" ? detailValue : JSON.stringify(detailValue);
				const paddedPath = path.length > 24 ? `${path.slice(0, 21)}...` : path.padEnd(24, " ");
				console.log(`  ${paddedPath} | ${safeValue}`);
			}
		}
	});

	if (totalPages > 1) {
		console.log(line);
		console.log(`Page ${currentPage} of ${totalPages}. Use --page <n> to view other pages.`);
	}
}

async function cmdServer(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const newUrl = args._[0] as string | undefined;
	const clear = args["clear"] ?? false;

	if (clear) {
		const state = await updateState(ctx.identityDir, { server: undefined });
		console.log("Server URL cleared.");
		if (state.currentIdentity) {
			console.log(`Current identity remains: ${state.currentIdentity}`);
		}
		return;
	}

	if (!newUrl) {
		if (ctx.server) {
			console.log(`Current server: ${ctx.server}`);
		} else {
			console.log("No server configured. Set one with: ebp server <url>");
		}
		return;
	}

	await updateState(ctx.identityDir, { server: newUrl });
	console.log(`✓ Server set to: ${newUrl}`);
}

// ============================================================================
// Main
// ============================================================================

function printHelp(): void {
	console.log(`ebp - Post-quantum cryptography CLI (v${COMPONENT_VERSIONS.cli}, protocol ${PROTOCOL_VERSION})

USAGE:
  ebp <command> [options] [arguments]

COMMANDS:
  generate [name]       Generate a new identity (default: identity)
    --signing <type>    Signing key type: dilithium (default) or sphincs
    --encryption <type> Encryption key type: kyber (default)
    --force             Overwrite existing identity
    --revocation-cert   Generate an emergency revocation certificate
    --revocation-output <file>  Save emergency certificate to file

  identities            List available identities (marks current)
  use <name>            Switch to an existing identity
  details               Show fingerprint, key types, and attached details

  publish               Publish current identity to configured server
    --server <url>      Override server for this command

  server-identities     List identities on the configured server
    --page <n>          Page number (default: 1)
    --server <url>      Override server for this command
    --search <text>     Search by name, email, or fingerprint

  fetch <fingerprint>   Fetch a contact by fingerprint from server
    --name <name>       Save contact under this name
    --server <url>      Override server for this command

  info                  Show identity information

  export-public         Export public key (external identity)
    --output <file>     Write to file instead of stdout

  import <file>         Import a contact's public key
    --name <name>       Name for the contact (default: fingerprint prefix)

  contacts              List all contacts

  detail <path> <value> Attach a detail to your identity (e.g., name, email)
    --push              Also push the detail to the configured server

  revoke-detail <path>  Revoke a detail from your identity
    --reason <reason>   Optional reason for revocation
    --push              Also push the revocation to the configured server

  revoke                Revoke the entire identity (marks as compromised)
    --reason <reason>   Optional reason for revocation
    --force             Required confirmation flag
    --push              Also push the revocation to the configured server

  generate-revocation-cert  Generate an emergency revocation certificate
    --output <file>     Save certificate to file instead of stdout

  sign [file]           Sign a message
    --output <file>     Write to file instead of stdout
    --detached          Output signature only (not message)
    --no-salt           Disable random salt in hash-envelope signing

  verify [file]         Verify a signed message
    --signature <file>  Detached signature file
    --sender <name>     Sender's contact name

  encrypt [file]        Encrypt a message
    --recipient <name>  Recipient's contact name (required)
    --output <file>     Write to file instead of stdout
    --sign              Also sign the message

  decrypt [file]        Decrypt a message
    --sender <name>     Sender's contact name (for signed messages)

  server [url]          Show or set the server base URL
    --clear             Remove the configured server URL

COMMON OPTIONS:
  --password <pwd>      Password (avoid - will be visible in shell history)
  --identity <name>     Operate on a specific identity without switching
  --home <dir>          Override home directory for key storage
  --server <url>        Override server for a single command
  --help, -h            Show this help message
  --version, -v         Show version

EXAMPLES:
  # Generate a new identity
  ebp generate
  # Generate another identity named "work"
  ebp generate work

  # Export your public key for sharing
  ebp export-public -o my-public-key.json

  # Import a friend's public key
  ebp import friend-public-key.json --name alice

  # Sign a message
  echo "Hello world" | ebp sign > signed.json

  # Verify a signed message
  ebp verify signed.json --sender alice

  # Encrypt for someone
  echo "Secret message" | ebp encrypt --recipient alice > encrypted.json

  # Sign and encrypt
  echo "Secret message" | ebp encrypt --recipient alice --sign > encrypted.json

  # Decrypt a message
  ebp decrypt encrypted.json --sender alice

  # Show current identity details
  ebp details

  # Switch to another identity
  ebp use work

  # Revoke a detail (e.g., old email)
  ebp revoke-detail email --reason "Changed email" --push

  # Revoke entire identity (if compromised)
  ebp revoke --reason "Key compromised" --force --push
`);
}

async function main(): Promise<void> {
	const args = parseArgs(Deno.args, {
		string: ["signing", "encryption", "output", "name", "recipient", "sender", "signature", "password", "home", "identity", "server", "page", "reason", "revocation-output", "search"],
		boolean: ["help", "version", "force", "detached", "sign", "push", "clear", "revocation-cert", "no-salt"],
		alias: { h: "help", v: "version", o: "output", r: "recipient", s: "sender" },
	});

	if (args.version) {
		console.log(`ebp v${COMPONENT_VERSIONS.cli} (protocol ${PROTOCOL_VERSION})`);
		Deno.exit(0);
	}

	if (args.help || args._.length === 0) {
		printHelp();
		Deno.exit(0);
	}

	const ctx = await getContext(
		args["home"] as string | undefined,
		args["identity"] as string | undefined,
		args["server"] as string | undefined,
	);
	const command = args._[0] as string;
	args._ = args._.slice(1); // Remove command from args

	switch (command) {
		case "generate":
			await cmdGenerate(args, ctx);
			break;
		case "details":
			await cmdShowDetails(args, ctx);
			break;
		case "info":
			await cmdInfo(args, ctx);
			break;
		case "export-public":
		case "export":
			await cmdExportPublic(args, ctx);
			break;
		case "import":
			await cmdImportContact(args, ctx);
			break;
		case "contacts":
		case "list":
			await cmdListContacts(args, ctx);
			break;
		case "identities":
			await cmdListIdentities(ctx);
			break;
		case "use":
			await cmdUseIdentity(args, ctx);
			break;
		case "detail":
			await cmdAttachDetail(args, ctx);
			break;
		case "revoke-detail":
			await cmdRevokeDetail(args, ctx);
			break;
		case "revoke":
			await cmdRevokeIdentity(args, ctx);
			break;
		case "generate-revocation-cert":
			await cmdGenerateRevocationCert(args, ctx);
			break;
		case "publish":
			await cmdPublishIdentity(args, ctx);
			break;
		case "server-identities":
			await cmdListServerIdentities(args, ctx);
			break;
		case "fetch":
			await cmdFetchIdentity(args, ctx);
			break;
		case "server":
			await cmdServer(args, ctx);
			break;
		case "sign":
			await cmdSign(args, ctx);
			break;
		case "verify":
			await cmdVerify(args, ctx);
			break;
		case "encrypt":
			await cmdEncrypt(args, ctx);
			break;
		case "decrypt":
			await cmdDecrypt(args, ctx);
			break;
		default:
			console.error(`Unknown command: ${command}`);
			console.error("Run 'ebp --help' for usage information.");
			Deno.exit(1);
	}
}

main();


