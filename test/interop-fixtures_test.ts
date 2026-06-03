import { assertEquals } from "jsr:@std/assert";
import { buildFileSignMessage } from "../core/CryptoUtils.ts";
import { parseEbpPayloadInput } from "../core/PayloadInput.ts";

const fixturesDir = new URL("./fixtures/interop/", import.meta.url);

Deno.test("interop fixture: armored encrypted message parses", async () => {
  const raw = await Deno.readTextFile(
    new URL("armored-encrypted-message.txt", fixturesDir),
  );
  const payload = parseEbpPayloadInput(raw);
  assertEquals(payload.type, "ebp-encrypted-message");
  assertEquals(payload.version, 1);
});

Deno.test("interop fixture: versioned encrypted signed file parses", async () => {
  const raw = await Deno.readTextFile(
    new URL("encrypted-signed-file-v1.json", fixturesDir),
  );
  const payload = parseEbpPayloadInput(raw);
  assertEquals(payload.type, "ebp-encrypted-signed-file");
  assertEquals(payload.version, 1);
  assertEquals(payload.fileName, "doc.pdf");
});

Deno.test("buildFileSignMessage matches GUI wire format", () => {
  assertEquals(
    buildFileSignMessage("abc123", "deadbeef", "context"),
    "ebp::filehash::abc123::deadbeef::context",
  );
});
