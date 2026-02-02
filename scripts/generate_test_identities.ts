#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Test script to generate 7 random identities and upload them to the server.
 * All identities use "password" as the password.
 */

import { Identity } from "../core/Identity.ts";
import { sha256 } from "@noble/hashes/sha2";

const SERVER_URL = Deno.env.get("SERVER_URL") ?? "http://localhost:8080";
const PASSWORD = "password";
const NUM_IDENTITIES = 7;

// Names for our test identities
const IDENTITY_NAMES = [
  "alice",
  "bob", 
  "charlie",
  "diana",
  "eve",
  "frank",
  "grace",
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function computeStateHash(state: Record<string, unknown>): string {
  const canonical = canonicalize(state);
  const data = new TextEncoder().encode(JSON.stringify(canonical));
  return toHex(sha256(data));
}

type IdentityState = {
  fingerprint: string;
  signingKeyType: string;
  encryptionKeyType: string;
  signingKey: string;
  encryptionKey: string;
  signingKeyDetails?: Record<string, unknown> | null;
  encryptionKeyDetails?: Record<string, unknown> | null;
  details: Record<string, [string, string]>;
};

function buildStateFromIdentity(identity: Identity): IdentityState {
  const summary = identity.summary;
  return {
    fingerprint: summary.fingerprint,
    signingKeyType: summary.signingKeyType,
    encryptionKeyType: summary.encryptionKeyType,
    signingKey: summary.signingKey,
    encryptionKey: summary.encryptionKey,
    signingKeyDetails: summary.signingKeyDetails ?? null,
    encryptionKeyDetails: summary.encryptionKeyDetails ?? null,
    details: {},
  };
}

async function uploadIdentity(identity: Identity, name: string): Promise<void> {
  const summary = identity.summary;
  
  // Build state for this new identity (no prior state on server)
  const fromState = null;
  const targetState = buildStateFromIdentity(identity);
  const toState = computeStateHash(targetState);
  
  // Sign the state transition
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
  
  const res = await fetch(`${SERVER_URL}/api/v1/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to upload ${name}: ${body.error ?? res.statusText}`);
  }
  
  const result = await res.json();
  console.log(`✓ Uploaded ${name}: ${result.fingerprint}`);
}

async function main() {
  console.log(`Generating and uploading ${NUM_IDENTITIES} test identities to ${SERVER_URL}...\n`);
  
  const identities: { name: string; identity: Identity }[] = [];
  
  for (let i = 0; i < NUM_IDENTITIES; i++) {
    const name = IDENTITY_NAMES[i];
    console.log(`Generating identity for ${name}...`);
    
    // Create new identity with dilithium signing + kyber encryption
    const identity = new Identity("dilithium", "kyber");
    
    // Optionally attach a "name" detail
    identity.attachDetail("name", name);
    
    identities.push({ name, identity });
    console.log(`  Fingerprint: ${identity.toFingerprint()}`);
  }
  
  console.log("\nUploading identities to server...\n");
  
  for (const { name, identity } of identities) {
    try {
      await uploadIdentity(identity, name);
    } catch (e) {
      console.error(`✗ Failed to upload ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  console.log("\nDone! All identities have been uploaded.");
  
  // Optionally save identities locally for later use
  const outputDir = "./test_identities";
  try {
    await Deno.mkdir(outputDir, { recursive: true });
    for (const { name, identity } of identities) {
      const storageData = await identity.toStorageFormat(PASSWORD);
      await Deno.writeTextFile(`${outputDir}/${name}.identity.json`, storageData);
    }
    console.log(`\nIdentities saved to ${outputDir}/ (password: "${PASSWORD}")`);
  } catch (e) {
    console.error(`Failed to save identities locally: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main();

