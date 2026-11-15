import { assertEquals, assertThrows } from "jsr:@std/assert";
import { hexToBytes } from "../core/Hex.ts";

Deno.test("F-CRYPTO-08: hexToBytes rejects non-hex characters", () => {
  assertEquals(Array.from(hexToBytes("00aF")), [0x00, 0xaf]);

  for (const value of ["zz", "0x00", "00 11", "0g"]) {
    assertThrows(() => hexToBytes(value), Error, "invalid hex");
  }
});

Deno.test("toHex encodes all byte values, empty input, and offset views", async () => {
  const { toHex } = await import("../core/Hex.ts");
  const bytes = Uint8Array.from({length: 256}, (_, i) => i);
  const expected = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(toHex(bytes), expected);
  assertEquals(toHex(bytes.subarray(15, 18)), "0f1011");
  assertEquals(toHex(new Uint8Array()), "");
});
