import { assertEquals } from "@std/assert";
import { Identity } from "../Identity.ts";
import { hexToString, stringToHex } from "../Hex.ts";
import {
  parseDetailProof,
  validateDetailHistoryStructure,
} from "../DetailProof.ts";

Deno.test("detail verification authenticates proofs and rejects a different signer", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("name", "Alice");
  assertEquals(identity.verifyDetails(), true);
  const other = new Identity("dilithium", "kyber");
  other.details = new Map(identity.details);
  assertEquals(other.verifyDetails(), false);
  const record = JSON.parse(hexToString(identity.details.get("name")![1]));
  record.detail = "Mallory";
  record.signature = "definitely not a signature";
  identity.details.set("name", [
    record.detail,
    stringToHex(JSON.stringify(record)),
  ]);
  assertEquals(validateDetailHistoryStructure(identity.details), true);
  assertEquals(identity.verifyDetails(), false);
  assertEquals(identity.getDetail("name"), null);
});

Deno.test("nonce ordering accepts equal timestamps and a backward wall clock", () => {
  const identity = new Identity("dilithium", "kyber");
  const now = Date.now;
  let time = 100;
  Date.now = () => time;
  try {
    identity.attachDetail("name", "Alice");
    identity.attachDetail("role", "admin");
    time = 99;
    identity.attachDetail("city", "Ottawa");
  } finally {
    Date.now = now;
  }
  assertEquals(identity.verifyDetails(), true);
  assertEquals(identity.getDetail("city"), "Ottawa");
});

Deno.test("malformed proof JSON fails closed", () => {
  for (const value of [null, [], 1, "proof", { version: 2 }]) {
    assertEquals(
      parseDetailProof({
        path: "name",
        detail: "Alice",
        proof: stringToHex(JSON.stringify(value)),
      }).ok,
      false,
    );
  }
});
