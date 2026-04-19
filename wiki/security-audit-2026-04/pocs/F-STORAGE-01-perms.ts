// F-STORAGE-01 / F-STORAGE-04 — file & directory permission demo
//
// Demonstrates that EBP's CLI / GUI codepaths use Deno.writeTextFile and
// Deno.mkdir without explicit `mode:` options, resulting in 0644 files and
// 0755 directories under typical 022 umask.
//
// Run:
//   deno run --allow-read --allow-write wiki/security-audit-2026-04/pocs/F-STORAGE-01-perms.ts

import { Identity } from "../../../core/Identity.ts";

const tmpDir = await Deno.makeTempDir({ prefix: "ebp-storage-poc-" });
console.log(`tmp dir: ${tmpDir}`);

await Deno.mkdir(`${tmpDir}/.ebp`, { recursive: true });

const id = new Identity("dilithium", "kyber");
const storage = id.toStorageFormat("auditpass1");
await Deno.writeTextFile(`${tmpDir}/.ebp/audit-test.identity.json`, storage);
await Deno.writeTextFile(`${tmpDir}/.ebp/state.json`, JSON.stringify({ currentIdentity: "audit-test" }, null, 2));

const dirInfo = await Deno.stat(`${tmpDir}/.ebp`);
const fileInfo = await Deno.stat(`${tmpDir}/.ebp/audit-test.identity.json`);
const stateInfo = await Deno.stat(`${tmpDir}/.ebp/state.json`);

const fmt = (m: number | null) => m === null ? "?" : m.toString(8);

console.log(`~/.ebp                            mode = ${fmt(dirInfo.mode)} (want 0700)`);
console.log(`~/.ebp/audit-test.identity.json   mode = ${fmt(fileInfo.mode)} (want 0600)`);
console.log(`~/.ebp/state.json                 mode = ${fmt(stateInfo.mode)} (want 0600)`);
