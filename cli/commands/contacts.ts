import { parseArgs } from "@std/cli/parse-args";
import { ExternalIdentity } from "../../core/Identity.ts";
import {
	type CLIContext,
	ensurePrivateDir,
	readStdin,
} from "../utils.ts";

export async function cmdImportContact(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
	
	await ensurePrivateDir(ctx.contactsDir);

	const contactName = name ?? external.fingerprint.substring(0, 16);
	const contactPath = `${ctx.contactsDir}/${contactName}.json`;

	await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2), { mode: 0o600 });
	console.log(`✓ Contact imported: ${contactName}`);
	console.log(`  Fingerprint: ${external.fingerprint}`);
}

export async function cmdListContacts(_args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

export async function loadContact(ctx: CLIContext, nameOrFingerprint: string): Promise<ExternalIdentity> {
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
