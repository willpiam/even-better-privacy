import { assert, assertEquals } from "jsr:@std/assert";
import {
  compareProtocolVersions,
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
} from "../core/version.ts";

Deno.test("protocol version comparison includes patch", () => {
  assert(compareProtocolVersions("0.1.2", "0.1.1") > 0);
  assert(compareProtocolVersions("0.1.0", "0.1.1") < 0);
  assertEquals(compareProtocolVersions("0.1.1", "0.1.1"), 0);
});

Deno.test("protocol support parses patch but accepts patch-only differences", () => {
  assertEquals(PROTOCOL_VERSION, "0.1.1");
  assert(isProtocolVersionSupported("0.1.0"));
  assert(isProtocolVersionSupported("0.1.99"));
});

Deno.test("protocol support enforces major and minimum version", () => {
  assert(isProtocolVersionSupported("0.0.1"));
  assert(!isProtocolVersionSupported("0.0.0"));
  assert(!isProtocolVersionSupported("1.0.0"));
  assert(!isProtocolVersionSupported("0.1"));
  assert(!isProtocolVersionSupported("garbage"));
});
