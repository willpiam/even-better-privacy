#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { parseArgs } from "@std/cli/parse-args";
import { PROTOCOL_VERSION } from "../core/version.ts";
import { COMPONENT_VERSIONS } from "../app-version.ts";
import { fixLegacyPerms, getContext } from "./utils.ts";

import {
  cmdExportPublic,
  cmdGenerate,
  cmdInfo,
  cmdListIdentities,
  cmdShowDetails,
  cmdUseIdentity,
} from "./commands/identity.ts";
import { cmdHd } from "./commands/hd.ts";
import { cmdImportContact, cmdListContacts } from "./commands/contacts.ts";
import {
  cmdDecrypt,
  cmdEncrypt,
  cmdSign,
  cmdVerify,
} from "./commands/crypto.ts";
import { cmdDecryptFile, cmdEncryptFile } from "./commands/files.ts";
import {
  cmdAttachDetail,
  cmdGenerateRevocationCert,
  cmdRevokeDetail,
  cmdRevokeIdentity,
} from "./commands/details.ts";
import {
  cmdFetchIdentity,
  cmdListServerIdentities,
  cmdPublishIdentity,
  cmdServer,
} from "./commands/server.ts";

// ============================================================================
// Main
// ============================================================================

const STRING_FLAGS = [
  "signing",
  "encryption",
  "output",
  "name",
  "recipient",
  "sender",
  "signature",
  "password",
  "home",
  "identity",
  "server",
  "page",
  "reason",
  "revocation-output",
  "search",
  "strength",
  "mnemonic",
  "passphrase",
  "path",
  "out",
  "account",
  "profile",
  "change",
  "index",
  "gap-limit",
];
const BOOLEAN_FLAGS = [
  "help",
  "version",
  "force",
  "detached",
  "sign",
  "push",
  "clear",
  "revocation-cert",
  "no-salt",
  "opaque",
];
const FLAG_ALIASES: Record<string, string> = {
  h: "help",
  v: "version",
  o: "output",
  r: "recipient",
  s: "sender",
};
const KNOWN_FLAGS = new Set([
  ...STRING_FLAGS,
  ...BOOLEAN_FLAGS,
  ...Object.keys(FLAG_ALIASES),
]);

function findUnknownFlags(argv: string[]): string[] {
  const unknown: string[] = [];
  for (const token of argv) {
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-") continue;

    if (token.startsWith("--")) {
      const name = token.slice(2).split("=", 1)[0];
      if (name && !KNOWN_FLAGS.has(name)) unknown.push(`--${name}`);
      continue;
    }

    for (const alias of token.slice(1)) {
      if (!KNOWN_FLAGS.has(alias)) unknown.push(`-${alias}`);
    }
  }
  return [...new Set(unknown)];
}

function printHelp(): void {
  console.log(
    `ebp - Post-quantum cryptography CLI (v${COMPONENT_VERSIONS.cli}, protocol ${PROTOCOL_VERSION})

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

  hd generate-mnemonic  Generate an EBP-HD mnemonic
    --strength <bits>   Entropy bits: 128, 160, 192, 224, or 256
  hd verify-mnemonic    Validate an EBP-HD mnemonic from --mnemonic or stdin
  hd derive             Derive an identity from a specific HD path
    --path <path>       Example: "m/ebp'/dilithium'/0'/0/0"
    --out <name>        Identity name to write under ~/.ebp/
    --revocation-cert   Print an emergency revocation certificate
    --revocation-output <file>  Save emergency certificate to file
  hd new-identity <name>  Derive the next account identity
    --account <n>       Account/persona number (default: 0)
    --profile <type>    dilithium (default) or sphincs
    --change <type>     external (default) or internal
    --revocation-cert   Print an emergency revocation certificate
    --revocation-output <file>  Save emergency certificate to file
  hd discover           Scan derived external fingerprints with a gap limit

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
    --opaque            Prefixes path with opaque:: and stores SHA-256(value)

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

  encrypt-file <file>   Encrypt a file into a JSON payload
    --recipient <name>  Recipient's contact name (required)
    --output <file>     Write payload JSON to file (default: stdout)
    --sign              Also sign the encrypted payload

  decrypt-file <file>   Decrypt a file payload JSON into a file
    --sender <name>     Sender's contact name (for signed payloads)
    --output <file>     Output file path (default: payload fileName)

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

  # Encrypt a file for someone
  ebp encrypt-file ./secret.pdf --recipient alice --output encrypted-file.json

  # Decrypt an encrypted file payload
  ebp decrypt-file encrypted-file.json --sender alice --output restored.pdf

  # Show current identity details
  ebp details

  # Switch to another identity
  ebp use work

  # Revoke a detail (e.g., old email)
  ebp revoke-detail email --reason "Changed email" --push

  # Revoke entire identity (if compromised)
  ebp revoke --reason "Key compromised" --force --push
`,
  );
}

async function main(): Promise<void> {
  const unknownFlags = findUnknownFlags(Deno.args);
  if (unknownFlags.length > 0) {
    console.error(
      `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${
        unknownFlags.join(", ")
      }`,
    );
    console.error("Run 'ebp --help' for usage information.");
    Deno.exit(1);
  }

  const args = parseArgs(Deno.args, {
    string: STRING_FLAGS,
    boolean: BOOLEAN_FLAGS,
    alias: FLAG_ALIASES,
  });

  if (typeof args["password"] === "string") {
    console.error(
      "[ebp] warning: --password exposes secrets via shell history/process listings; prefer the interactive prompt.",
    );
  }

  if (args.version) {
    console.log(
      `ebp v${COMPONENT_VERSIONS.cli} (protocol ${PROTOCOL_VERSION})`,
    );
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

  // F-STORAGE-01/04: tighten any pre-existing loose permissions under
  // ~/.ebp/ on startup. Best-effort: no error if the directory does not
  // exist yet or chmod is unsupported on this platform.
  await fixLegacyPerms(ctx.identityDir);

  const command = args._[0] as string;
  args._ = args._.slice(1); // Remove command from args

  switch (command) {
    case "generate":
      await cmdGenerate(args, ctx);
      break;
    case "details":
      await cmdShowDetails(args, ctx);
      break;
    case "hd":
      await cmdHd(args, ctx);
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
    case "encrypt-file":
      await cmdEncryptFile(args, ctx);
      break;
    case "decrypt-file":
      await cmdDecryptFile(args, ctx);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'ebp --help' for usage information.");
      Deno.exit(1);
  }
}

main();
