import { parseArgs } from "@std/cli/parse-args";
import { Identity } from "../../core/Identity.ts";
import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "../../core/Mnemonic.ts";
import {
  formatHdPath,
  type HdChange,
  type HdProfile,
  parseHdPath,
} from "../../core/HdPath.ts";
import { validatePassword } from "../../core/PasswordPolicy.ts";
import {
  type CLIContext,
  ensurePrivateDir,
  getIdentityPath,
  listIdentityNames,
  readPassword,
  updateState,
} from "../utils.ts";

const DEFAULT_GAP_LIMIT = 20;

function usage(): never {
  console.error(`Usage:
  ebp hd generate-mnemonic [--strength 128|160|192|224|256]
  ebp hd verify-mnemonic [--mnemonic <words>]
  ebp hd derive --path <path> [--mnemonic <words>] [--passphrase <phrase>] --out <name>
  ebp hd new-identity <name> --account <n> [--profile dilithium|sphincs] [--change external|internal] [--index <n>] [--mnemonic <words>]
  ebp hd discover [--account <n>] [--profile dilithium|sphincs] [--gap-limit <n>] [--server <url>] [--mnemonic <words>]`);
  Deno.exit(1);
}

function stringArg(
  args: ReturnType<typeof parseArgs>,
  name: string,
): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

function numberArg(
  args: ReturnType<typeof parseArgs>,
  name: string,
  fallback?: number,
): number {
  const value = stringArg(args, name);
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`Missing --${name}`);
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function profileArg(args: ReturnType<typeof parseArgs>): HdProfile {
  const profile = stringArg(args, "profile") ?? "dilithium";
  if (profile !== "dilithium" && profile !== "sphincs") {
    throw new Error("--profile must be dilithium or sphincs");
  }
  return profile;
}

function changeArg(args: ReturnType<typeof parseArgs>): HdChange {
  const change = stringArg(args, "change") ?? "external";
  if (change !== "external" && change !== "internal") {
    throw new Error("--change must be external or internal");
  }
  return change;
}

async function readStdinText(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) chunks.push(chunk);
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(out).trim();
}

async function readMnemonic(
  args: ReturnType<typeof parseArgs>,
): Promise<string> {
  const direct = stringArg(args, "mnemonic");
  if (direct) return direct;
  const stdin = await readStdinText();
  if (!stdin) throw new Error("Provide mnemonic via --mnemonic or stdin");
  return stdin;
}

async function nextUnusedIndex(
  ctx: CLIContext,
  seed: Uint8Array,
  profile: HdProfile,
  account: number,
  change: HdChange,
): Promise<number> {
  const existing = new Set<string>();
  for (const name of await listIdentityNames(ctx.identityDir)) {
    try {
      const data = await Deno.readTextFile(
        getIdentityPath(ctx.identityDir, name),
      );
      const pub = Identity.readPublicData(data);
      if (pub?.fingerprint) existing.add(pub.fingerprint);
    } catch {
      // Ignore unreadable identities while searching for an unused HD slot.
    }
  }
  for (let index = 0; index < 100_000; index++) {
    const identity = Identity.fromAccount(seed, {
      profile,
      account,
      change,
      index,
    });
    if (!existing.has(identity.toFingerprint())) return index;
  }
  throw new Error("Unable to find an unused HD identity slot");
}

async function saveIdentity(
  ctx: CLIContext,
  name: string,
  identity: Identity,
  force: boolean,
  options?: { revocationCert?: boolean; revocationOutput?: string | undefined },
): Promise<void> {
  const path = getIdentityPath(ctx.identityDir, name);
  try {
    await Deno.stat(path);
    if (!force) {
      throw new Error("Identity already exists. Use --force to overwrite.");
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  const password = await readPassword(
    "Enter password to protect your HD identity: ",
  );
  const confirmPassword = await readPassword("Confirm password: ");
  if (password !== confirmPassword) throw new Error("Passwords do not match.");
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    throw new Error(
      [passwordCheck.reason, ...passwordCheck.suggestions.map((s) => `- ${s}`)]
        .join("\n"),
    );
  }

  await ensurePrivateDir(ctx.identityDir);
  await ensurePrivateDir(ctx.contactsDir);
  await Deno.writeTextFile(path, identity.toStorageFormat(password), {
    mode: 0o600,
  });
  await updateState(ctx.identityDir, { currentIdentity: name });
  console.log("✓ HD identity generated successfully!");
  console.log(`  Name: ${name}`);
  console.log(`  Path: ${identity.hdProvenance?.path}`);
  console.log(`  Fingerprint: ${identity.toFingerprint()}`);
  console.log(`  Stored at: ${path}`);

  if (options?.revocationCert || options?.revocationOutput) {
    const certData = JSON.stringify(
      {
        type: "ebp-emergency-revocation-certificate",
        version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
        fingerprint: identity.toFingerprint(),
        hdProvenance: identity.hdProvenance,
        certificate: identity.generateEmergencyRevocationCertificate(),
        createdAt: new Date().toISOString(),
        warning:
          "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
      },
      null,
      2,
    );
    if (options.revocationOutput) {
      await Deno.writeTextFile(options.revocationOutput, certData, {
        mode: 0o600,
      });
      console.log(
        `  Emergency revocation certificate: ${options.revocationOutput}`,
      );
    } else {
      console.log("\nEmergency Revocation Certificate:");
      console.log(certData);
    }
  }
}

async function discoverLocal(
  ctx: CLIContext,
  seed: Uint8Array,
  input: {
    profile: HdProfile;
    account: number;
    gapLimit: number;
    server?: string;
  },
): Promise<void> {
  const localFingerprints = new Map<string, string>();
  for (const name of await listIdentityNames(ctx.identityDir)) {
    try {
      const pub = Identity.readPublicData(
        await Deno.readTextFile(getIdentityPath(ctx.identityDir, name)),
      );
      if (pub?.fingerprint) localFingerprints.set(pub.fingerprint, name);
    } catch {
      // Ignore unreadable identities during discovery.
    }
  }

  let gap = 0;
  for (let index = 0; gap < input.gapLimit; index++) {
    const identity = Identity.fromAccount(seed, {
      profile: input.profile,
      account: input.account,
      change: "external",
      index,
    });
    const fingerprint = identity.toFingerprint();
    const localName = localFingerprints.get(fingerprint);
    let serverFound = false;
    if (input.server) {
      const res = await fetch(
        `${input.server.replace(/\/$/, "")}/api/v1/identity/${fingerprint}`,
      );
      serverFound = res.ok;
    }
    if (localName || serverFound) {
      gap = 0;
      console.log(
        `${index}: ${fingerprint}${localName ? ` local=${localName}` : ""}${
          serverFound ? " server=published" : ""
        }`,
      );
    } else {
      gap++;
    }
  }
}

export async function cmdHd(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const subcommand = args._[0] as string | undefined;
  args._ = args._.slice(1);
  try {
    switch (subcommand) {
      case "generate-mnemonic": {
        const strength = numberArg(args, "strength", 256);
        console.log(generateMnemonic(strength));
        return;
      }
      case "verify-mnemonic": {
        const mnemonic = await readMnemonic(args);
        if (!validateMnemonic(mnemonic)) {
          console.error("Mnemonic is invalid.");
          Deno.exit(1);
        }
        console.log("Mnemonic is valid.");
        return;
      }
      case "derive": {
        const path = stringArg(args, "path");
        const out = stringArg(args, "out") ?? stringArg(args, "output");
        if (!path || !out) usage();
        const parsed = parseHdPath(path);
        const mnemonic = await readMnemonic(args);
        const seed = mnemonicToSeed(
          mnemonic,
          stringArg(args, "passphrase") ?? "",
        );
        const identity = Identity.fromAccount(seed, {
          profile: parsed.profile!,
          account: parsed.account!,
          change: parsed.change!,
          index: parsed.index!,
        });
        await saveIdentity(ctx, out, identity, Boolean(args.force), {
          revocationCert: Boolean(args["revocation-cert"]),
          revocationOutput: stringArg(args, "revocation-output"),
        });
        return;
      }
      case "new-identity": {
        const name = (args._[0] as string | undefined) ??
          stringArg(args, "name");
        if (!name) usage();
        const profile = profileArg(args);
        const change = changeArg(args);
        const account = numberArg(args, "account", 0);
        const mnemonic = await readMnemonic(args);
        const seed = mnemonicToSeed(
          mnemonic,
          stringArg(args, "passphrase") ?? "",
        );
        const index = stringArg(args, "index") === undefined
          ? await nextUnusedIndex(ctx, seed, profile, account, change)
          : numberArg(args, "index");
        const identity = Identity.fromAccount(seed, {
          profile,
          account,
          change,
          index,
        });
        await saveIdentity(ctx, name, identity, Boolean(args.force), {
          revocationCert: Boolean(args["revocation-cert"]),
          revocationOutput: stringArg(args, "revocation-output"),
        });
        return;
      }
      case "discover": {
        const mnemonic = await readMnemonic(args);
        const seed = mnemonicToSeed(
          mnemonic,
          stringArg(args, "passphrase") ?? "",
        );
        await discoverLocal(ctx, seed, {
          profile: profileArg(args),
          account: numberArg(args, "account", 0),
          gapLimit: numberArg(args, "gap-limit", DEFAULT_GAP_LIMIT),
          server: stringArg(args, "server") ?? ctx.server,
        });
        return;
      }
      default:
        usage();
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}
