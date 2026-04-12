import { parseArgs } from "@std/cli/parse-args";
import { Identity, ExternalIdentity } from "../../core/Identity.ts";
import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import {
	createFileCleartextEnvelope,
	parseFileCleartextEnvelope,
	MAX_ENCRYPTED_FILE_BYTES,
} from "../../core/FilePayload.ts";
import {
	type CLIContext,
	loadIdentity,
	baseName,
	safeFileName,
} from "../utils.ts";
import { loadContact } from "./contacts.ts";

export async function cmdEncryptFile(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const recipientName = args["recipient"] as string;
	const inputPath = args._[0] as string | undefined;
	const outputPath = args["output"] as string | undefined;
	const sign = args["sign"] ?? false;
	if (!recipientName) {
		console.error("Recipient required. Use --recipient <name>");
		Deno.exit(1);
	}
	if (!inputPath) {
		console.error("Usage: ebp encrypt-file <file-path> --recipient <name> [--output <payload.json>] [--sign]");
		Deno.exit(1);
	}
	const fileBytes = await Deno.readFile(inputPath);
	if (fileBytes.length > MAX_ENCRYPTED_FILE_BYTES) {
		console.error(`File exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes).`);
		Deno.exit(1);
	}
	const recipient = await loadContact(ctx, recipientName);
	const fileName = safeFileName(baseName(inputPath));
	const mimeType = "application/octet-stream";
	const envelope = createFileCleartextEnvelope(fileBytes, fileName, mimeType);
	const cleartext = JSON.stringify(envelope);
	let output: string;
	if (sign) {
		const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
		const ciphertext = identity.signAndEncryptFor(cleartext, recipient);
		output = JSON.stringify({
			type: "ebp-encrypted-signed-file",
			version: FILE_FORMAT_VERSIONS.encryptedSignedFile,
			recipientFingerprint: recipient.fingerprint,
			senderFingerprint: identity.toFingerprint(),
			fileName,
			mimeType,
			fileSize: fileBytes.length,
			ciphertext,
		}, null, 2);
	} else {
		const ciphertext = Identity.EncryptFor(recipient, cleartext);
		output = JSON.stringify({
			type: "ebp-encrypted-file",
			version: FILE_FORMAT_VERSIONS.encryptedFile,
			recipientFingerprint: recipient.fingerprint,
			fileName,
			mimeType,
			fileSize: fileBytes.length,
			ciphertext,
		}, null, 2);
	}
	if (outputPath) {
		await Deno.writeTextFile(outputPath, output);
		console.error(`Encrypted file payload written to: ${outputPath}`);
	} else {
		console.log(output);
	}
}

export async function cmdDecryptFile(args: ReturnType<typeof parseArgs>, ctx: CLIContext): Promise<void> {
	const { identity } = await loadIdentity(ctx, args["password"] as string | undefined);
	const inputPath = args._[0] as string | undefined;
	const senderName = args["sender"] as string | undefined;
	const outputPath = args["output"] as string | undefined;
	if (!inputPath) {
		console.error("Usage: ebp decrypt-file <payload.json> [--sender <name>] [--output <file>]");
		Deno.exit(1);
	}
	const raw = await Deno.readTextFile(inputPath);
	const data = JSON.parse(raw) as Record<string, unknown>;
	const type = String(data.type ?? "");
	const ciphertext = String(data.ciphertext ?? "");
	if (!ciphertext) {
		console.error("Invalid payload: missing ciphertext.");
		Deno.exit(1);
	}

	let decryptedEnvelopeRaw = "";
	if (type === "ebp-encrypted-file") {
		decryptedEnvelopeRaw = identity.encryptionKey.decrypt(ciphertext);
		console.error("✓ File decrypted (unsigned - sender unknown)");
	} else if (type === "ebp-encrypted-signed-file") {
		let sender: ExternalIdentity;
		if (senderName) {
			sender = await loadContact(ctx, senderName);
		} else if (typeof data.senderFingerprint === "string") {
			sender = await loadContact(ctx, data.senderFingerprint.substring(0, 16));
		} else {
			console.error("Sender required to verify signature. Use --sender <name>");
			Deno.exit(1);
		}
		const result = identity.decryptAndVerify(ciphertext, sender);
		decryptedEnvelopeRaw = result.message;
		if (!result.verified) {
			console.error("✗ Decrypted file payload but signature verification FAILED!");
			Deno.exit(1);
		}
		console.error("✓ Decrypted file payload and verified signature");
	} else {
		console.error(`Unknown file payload type: ${type}`);
		Deno.exit(1);
	}

	const envelope = parseFileCleartextEnvelope(decryptedEnvelopeRaw);
	if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
		console.error(`Refusing to write file larger than ${MAX_ENCRYPTED_FILE_BYTES} bytes.`);
		Deno.exit(1);
	}
	const finalPath = outputPath || safeFileName(envelope.fileName);
	await Deno.writeFile(finalPath, envelope.fileBytes);
	console.error(`Decrypted file written to: ${finalPath}`);
}
