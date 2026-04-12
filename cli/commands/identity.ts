import { parseArgs } from "@std/cli/parse-args";
import { Identity } from "../../core/Identity.ts";
import { PROTOCOL_VERSION, FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import {
	type CLIContext,
	updateState,
	listIdentityNames,
	readState,
	getIdentityPath,
	ensureDir,
	readPassword,
	loadIdentity,
	randomHex,
} from "../utils.ts";

export async function cmdGenerate(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
	
	const storageData = identity.toStorageFormat(password);
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

export async function cmdInfo(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

export async function cmdExportPublic(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

export async function cmdListIdentities(ctx: CLIContext): Promise<void> {
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

export async function cmdUseIdentity(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const target = args._[0] as string | undefined;
	if (!target) {
		console.error("Usage: ebp use <identity>");
		Deno.exit(1);
	}
	
	// Check identity path
	const targetPath = getIdentityPath(ctx.identityDir, target);
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

export async function cmdShowDetails(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
