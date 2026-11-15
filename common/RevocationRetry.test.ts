import { assertEquals, assertNotEquals } from "@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  prepareDetailRevocation,
  prepareIdentityRevocation,
} from "./RevocationRetry.ts";

Deno.test("revocation retries reuse certificates after saving and reloading", () => {
  let identity = new Identity("dilithium", "kyber");
  identity.attachDetail("name", "Alice");
  const detailCertificate = prepareDetailRevocation(identity, "name");
  identity = Identity.fromJSON(identity.toJSON());
  assertEquals(prepareDetailRevocation(identity, "name"), detailCertificate);
  assertEquals(identity.revocationNonce, 1);
  identity.attachDetail("name", "Bob");
  assertNotEquals(prepareDetailRevocation(identity, "name"), detailCertificate);
  const identityCertificate = prepareIdentityRevocation(identity);
  identity = Identity.fromJSON(identity.toJSON());
  const nonce = identity.revocationNonce;
  assertEquals(prepareIdentityRevocation(identity), identityCertificate);
  assertEquals(identity.revocationNonce, nonce);
});
