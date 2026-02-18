#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { parseArgs } from "@std/cli/parse-args";
import { computeIdentityFingerprint } from "../core/Fingerprint.ts";

type IdentityStorage = {
  version?: number;
  public?: {
    fingerprint?: string;
    signingKeyType?: "dilithium" | "sphincs";
    encryptionKeyType?: "kyber";
    signingKey?: string;
    encryptionKey?: string;
    revocationCertificate?: string;
    revokedDetails?: Record<string, string>;
  };
};

type ExternalIdentity = {
  fingerprint?: string;
  signingKeyType?: "dilithium" | "sphincs";
  encryptionKeyType?: "kyber";
  signingKey?: string;
  encryptionKey?: string;
};

const args = parseArgs(Deno.args, {
  string: ["home"],
  boolean: ["dry-run"],
  default: {
    home: Deno.env.get("HOME") ?? ".",
    "dry-run": false,
  },
});

const home = String(args.home);
const dryRun = Boolean(args["dry-run"]);
const ebpDir = `${home}/.ebp`;
const contactsDir = `${ebpDir}/contacts`;

function isIdentityFile(name: string): boolean {
  return name.endsWith(".identity.json");
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, content);
  await Deno.rename(tmp, path);
}

function computeFingerprintFromKeys(
  signingKeyType: "dilithium" | "sphincs",
  encryptionKeyType: "kyber",
  signingKey: string,
  encryptionKey: string,
): string {
  return computeIdentityFingerprint({
    signingKeyType,
    encryptionKeyType,
    signingKey,
    encryptionKey,
  });
}

function contactNeedsRename(filename: string, oldFingerprint: string): boolean {
  const base = filename.replace(/\.json$/, "");
  return base === oldFingerprint || base === oldFingerprint.slice(0, 16);
}

async function migrateIdentityFiles(): Promise<{ scanned: number; updated: number; warnings: number }> {
  let scanned = 0;
  let updated = 0;
  let warnings = 0;

  try {
    for await (const entry of Deno.readDir(ebpDir)) {
      if (!entry.isFile || !isIdentityFile(entry.name)) continue;
      scanned++;
      const path = `${ebpDir}/${entry.name}`;
      const raw = await Deno.readTextFile(path);
      let parsed: IdentityStorage;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(`[warn] skipped invalid JSON identity file: ${path}`);
        warnings++;
        continue;
      }

      const pub = parsed.public;
      if (!pub?.signingKeyType || !pub.encryptionKeyType || !pub.signingKey || !pub.encryptionKey) {
        console.warn(`[warn] skipped identity with missing public key metadata: ${path}`);
        warnings++;
        continue;
      }

      const oldFp = pub.fingerprint ?? "";
      const newFp = computeFingerprintFromKeys(
        pub.signingKeyType,
        pub.encryptionKeyType,
        pub.signingKey,
        pub.encryptionKey,
      );

      if (oldFp === newFp) continue;

      if (pub.revocationCertificate || (pub.revokedDetails && Object.keys(pub.revokedDetails).length > 0)) {
        console.warn(
          `[warn] identity has revocation artifacts tied to old fingerprint; review after migration: ${path}`,
        );
        warnings++;
      }

      pub.fingerprint = newFp;
      if (!dryRun) {
        await writeAtomic(path, JSON.stringify(parsed, null, 2));
      }
      updated++;
      console.log(`[identity] ${entry.name}: ${oldFp} -> ${newFp}`);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { scanned: 0, updated: 0, warnings: 0 };
    }
    throw e;
  }

  return { scanned, updated, warnings };
}

async function migrateContactFiles(): Promise<{ scanned: number; updated: number; renamed: number; warnings: number }> {
  let scanned = 0;
  let updated = 0;
  let renamed = 0;
  let warnings = 0;

  try {
    for await (const entry of Deno.readDir(contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      scanned++;

      const path = `${contactsDir}/${entry.name}`;
      const raw = await Deno.readTextFile(path);
      let parsed: ExternalIdentity;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(`[warn] skipped invalid JSON contact file: ${path}`);
        warnings++;
        continue;
      }

      const {
        signingKeyType,
        encryptionKeyType,
        signingKey,
        encryptionKey,
      } = parsed;
      if (!signingKeyType || !encryptionKeyType || !signingKey || !encryptionKey) {
        console.warn(`[warn] skipped contact with missing key fields: ${path}`);
        warnings++;
        continue;
      }

      const oldFp = parsed.fingerprint ?? "";
      const newFp = computeFingerprintFromKeys(signingKeyType, encryptionKeyType, signingKey, encryptionKey);
      const changed = oldFp !== newFp;
      if (changed) {
        parsed.fingerprint = newFp;
        if (!dryRun) {
          await writeAtomic(path, JSON.stringify(parsed, null, 2));
        }
        updated++;
        console.log(`[contact] ${entry.name}: ${oldFp} -> ${newFp}`);
      }

      if (oldFp && contactNeedsRename(entry.name, oldFp)) {
        const targetName = `${newFp.slice(0, 16)}.json`;
        if (targetName !== entry.name) {
          const targetPath = `${contactsDir}/${targetName}`;
          if (!dryRun) {
            try {
              await Deno.stat(targetPath);
              console.warn(`[warn] not renaming ${entry.name}; target exists: ${targetName}`);
              warnings++;
            } catch (e) {
              if (e instanceof Deno.errors.NotFound) {
                await Deno.rename(path, targetPath);
                renamed++;
              } else {
                throw e;
              }
            }
          } else {
            renamed++;
          }
          console.log(`[contact-rename] ${entry.name} -> ${targetName}`);
        }
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { scanned: 0, updated: 0, renamed: 0, warnings: 0 };
    }
    throw e;
  }

  return { scanned, updated, renamed, warnings };
}

async function main(): Promise<void> {
  console.log(`Migrating EBP fingerprints under ${ebpDir}${dryRun ? " (dry-run)" : ""}`);

  const identityStats = await migrateIdentityFiles();
  const contactStats = await migrateContactFiles();

  console.log("\nMigration summary:");
  console.log(`- identity files scanned: ${identityStats.scanned}`);
  console.log(`- identity files updated: ${identityStats.updated}`);
  console.log(`- contact files scanned: ${contactStats.scanned}`);
  console.log(`- contact files updated: ${contactStats.updated}`);
  console.log(`- contact files renamed: ${contactStats.renamed}`);
  console.log(`- warnings: ${identityStats.warnings + contactStats.warnings}`);
}

if (import.meta.main) {
  await main();
}

