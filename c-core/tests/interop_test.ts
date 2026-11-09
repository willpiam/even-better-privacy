import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { AES } from "../../core/AES.ts";
import { sha256Hex } from "../../core/MessageHash.ts";

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const hex = (bytes: Uint8Array) => Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
async function python(request: Record<string, string>): Promise<Record<string, string>> {
  const command = new Deno.Command("python3", {
    args: ["c-core/tests/interop.py"], env: { PYTHONPATH: "python" },
    stdin: "piped", stdout: "piped", stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(request)));
  await writer.close();
  const result = await child.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

Deno.test("C and TypeScript SHA-256 match", async () => {
  for (const text of ["", "abc", "Unicode ☃ 🔐", "x".repeat(10000)]) {
    assertEquals((await python({ operation: "hash", text })).result, sha256Hex(text));
  }
});

Deno.test("TypeScript and C exchange AES ciphertexts in both directions", async () => {
  for (const text of ["", "hello\0world", "Unicode ☃ 🔐", "x".repeat(10000)]) {
    for (const aad of ["", "ebp:identity-storage:v2"]) {
      const common = { key: hex(key), aad };
      const fromTs = AES.encryptWithKey(key, text, salt, aad);
      assertEquals((await python({ operation: "decrypt", ciphertext: fromTs, ...common })).result, text);
      const fromC = (await python({ operation: "encrypt", text, salt: hex(salt), ...common })).result;
      assertEquals(AES.decryptWithKey(key, fromC, aad), text);
      assertEquals((await python({ operation: "decrypt", ciphertext: fromTs, key: hex(key), aad: "wrong" })).error, "invalid ciphertext");
    }
  }
});

Deno.test("C accepts legacy versions and ignores AAD as TypeScript does", async () => {
  const encoded = AES.encryptWithKey(key, "legacy", salt);
  for (const version of [1, 2, 3]) {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    bytes[0] = version;
    const legacy = btoa(String.fromCharCode(...bytes));
    assertEquals(AES.decryptWithKey(key, legacy, "ignored"), "legacy");
    assertEquals((await python({ operation: "decrypt", ciphertext: legacy, key: hex(key), aad: "ignored" })).result, "legacy");
  }
});
