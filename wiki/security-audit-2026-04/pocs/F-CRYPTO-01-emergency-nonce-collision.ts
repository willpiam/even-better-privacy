/**
 * F-CRYPTO-01 — Emergency revocation certificate nonce collision PoC
 *
 * Hypothesis: The emergency revocation certificate (`Identity.generateEmergencyRevocationCertificate`)
 * always signs with revocation-nonce 0. The regular revocation paths
 * (`Identity.revokeDetail`, `Identity.createIdentityRevocation`) start the counter at 0 and increment
 * after issuing. Because nonces are required to be strictly increasing on the server, the FIRST regular
 * revocation operation consumes the nonce-0 slot — silently invalidating the emergency certificate.
 *
 * Run from repo root:
 *   deno run -A wiki/security-audit-2026-04/pocs/F-CRYPTO-01-emergency-nonce-collision.ts
 *
 * Expected output: both certificates report nonce 0, demonstrating the collision.
 */

import { Identity } from "../../../core/Identity.ts";
import { decodeRevocationCertificate, isValidRevocationNonce } from "../../../core/Revocation.ts";

const alice = new Identity("dilithium", "kyber");
alice.attachDetail("email", "alice@example.com");

const emergencyEncoded = alice.generateEmergencyRevocationCertificate("loss/compromise");
const emergencyCert = decodeRevocationCertificate(emergencyEncoded)!;
console.log(`Emergency certificate nonce: ${emergencyCert.nonce}`);

const detailRevocationEncoded = alice.revokeDetail("email", "user changed email");
const detailRevocationCert = decodeRevocationCertificate(detailRevocationEncoded)!;
console.log(`First regular detail-revoke nonce: ${detailRevocationCert.nonce}`);

const collision = emergencyCert.nonce === detailRevocationCert.nonce;
console.log(`Both certificates use nonce 0: ${collision}`);

const serverHighestSeenNonce = detailRevocationCert.nonce;
const emergencyAcceptedAfterDetailRevoke = isValidRevocationNonce(
  emergencyCert.nonce,
  serverHighestSeenNonce,
);
console.log(
  `After server stores the regular revocation, would the emergency cert still be accepted? ${emergencyAcceptedAfterDetailRevoke}`,
);

if (collision && !emergencyAcceptedAfterDetailRevoke) {
  console.log(
    "\nCONFIRMED F-CRYPTO-01: a single benign detail revocation silently invalidates the pre-stored emergency revocation certificate.",
  );
  Deno.exit(0);
}
console.log("\nFinding NOT reproduced under current code — re-investigate.");
Deno.exit(1);
