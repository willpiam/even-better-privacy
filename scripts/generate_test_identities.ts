#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Test script to generate 7 random identities and upload them to the server.
 * All identities use "password" as the password.
 */

import { Identity } from "../core/Identity.ts";
import {
  buildIdentityStateFromExternal,
  computeStateHash,
  stableStringify,
} from "../core/StateHash.ts";

const SERVER_URL = Deno.env.get("EBP_SERVER_URL") ??
  Deno.env.get("SERVER_URL") ?? "http://localhost:8080";
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

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      url.hostname === "::1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

function buildStateFromIdentity(identity: Identity) {
  return buildIdentityStateFromExternal(identity.summary, {});
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
    throw new Error(
      `Failed to upload ${name}: ${body.error ?? res.statusText}`,
    );
  }

  const result = await res.json();
  console.log(`✓ Uploaded ${name}: ${result.fingerprint}`);
}

async function main() {
  if (Deno.env.get("EBP_TEST_FIXTURES") !== "1") {
    throw new Error(
      "Refusing to generate documented-password fixtures unless EBP_TEST_FIXTURES=1 is set.",
    );
  }
  if (!isLoopbackUrl(SERVER_URL)) {
    throw new Error(
      `Refusing to upload test identities to non-loopback server: ${SERVER_URL}`,
    );
  }

  console.log(
    `Generating and uploading ${NUM_IDENTITIES} test identities to ${SERVER_URL}...\n`,
  );

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
      console.error(
        `✗ Failed to upload ${name}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  console.log("\nDone! All identities have been uploaded.");

  // Optionally save identities locally for later use
  const outputDir = "./test_identities";
  try {
    await Deno.mkdir(outputDir, { recursive: true });
    for (const { name, identity } of identities) {
      const storageData = identity.toStorageFormat(PASSWORD);
      await Deno.writeTextFile(
        `${outputDir}/${name}.identity.json`,
        storageData,
      );
    }
    console.log(
      `\nIdentities saved to ${outputDir}/ (password: "${PASSWORD}")`,
    );
  } catch (e) {
    console.error(
      `Failed to save identities locally: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

main();
