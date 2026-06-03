import { assertEquals, assertThrows } from "jsr:@std/assert";
import { armorPayload } from "./Payloads.ts";
import { parseEbpPayloadInput } from "./PayloadInput.ts";

Deno.test("parseEbpPayloadInput: parses raw JSON", () => {
  const payload = parseEbpPayloadInput(
    JSON.stringify({ type: "ebp-signed-message", message: "hi" }),
  );
  assertEquals(payload.type, "ebp-signed-message");
});

Deno.test("parseEbpPayloadInput: parses armored payload", () => {
  const armored = armorPayload({ type: "ebp-encrypted-message", version: 1 });
  const payload = parseEbpPayloadInput(armored);
  assertEquals(payload.type, "ebp-encrypted-message");
});

Deno.test("parseEbpPayloadInput: rejects empty input", () => {
  assertThrows(() => parseEbpPayloadInput("   "), Error, "empty");
});
