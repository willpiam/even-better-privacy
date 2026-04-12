import { parseArgs } from "@std/cli/parse-args";
import { Identity, ExternalIdentity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
	buildDetachedSignaturePayload,
	buildEncryptedMessagePayload,
	buildEncryptedSignedMessagePayload,
	buildSignedMessagePayload,
} from "../../core/Payloads.ts";
import {
	type CLIContext,
	readStdin,
	loadIdentity,
	randomHex,
} from "../utils.ts";
import { loadContact } from "./contacts.ts";

export async function cmdSign(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
		const output = JSON.stringify(
			buildDetachedSignaturePayload({
				fingerprint: identity.toFingerprint(),
				messageHash,
				salt,
				signature,
			}),
			null,
			2,
		);
		
		if (outputFile) {
			await Deno.writeTextFile(outputFile, output);
			console.error(`Signature written to: ${outputFile}`);
		} else {
			console.log(output);
		}
	} else {
		// Output message + signature together
		const output = JSON.stringify(
			buildSignedMessagePayload({
				fingerprint: identity.toFingerprint(),
				message,
				messageHash,
				salt,
				signature,
			}),
			null,
			2,
		);
		
		if (outputFile) {
			await Deno.writeTextFile(outputFile, output);
			console.error(`Signed message written to: ${outputFile}`);
		} else {
			console.log(output);
		}
	}
}

export async function cmdVerify(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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

export async function cmdEncrypt(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
		
		output = JSON.stringify(
			buildEncryptedSignedMessagePayload({
				recipientFingerprint: recipient.fingerprint,
				senderFingerprint,
				ciphertext,
			}),
			null,
			2,
		);
	} else {
		const ciphertext = Identity.EncryptFor(recipient, message);
		
		output = JSON.stringify(
			buildEncryptedMessagePayload({
				recipientFingerprint: recipient.fingerprint,
				ciphertext,
			}),
			null,
			2,
		);
	}
	
	if (outputFile) {
		await Deno.writeTextFile(outputFile, output);
		console.error(`Encrypted message written to: ${outputFile}`);
	} else {
		console.log(output);
	}
}

export async function cmdDecrypt(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
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
