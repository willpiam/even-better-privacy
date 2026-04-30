import { assertEquals, assertThrows } from "jsr:@std/assert";
import { hexToBytes } from "../core/Hex.ts";

Deno.test("F-CRYPTO-08: hexToBytes rejects non-hex characters", () => {
  assertEquals(Array.from(hexToBytes("00aF")), [0x00, 0xaf]);

  for (const value of ["zz", "0x00", "00 11", "0g"]) {
    assertThrows(() => hexToBytes(value), Error, "invalid hex");
  }
});
