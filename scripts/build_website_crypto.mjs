import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = resolve(root, "tools/website-crypto");
const { build } = createRequire(resolve(buildRoot, "package.json"))("esbuild");
const check = process.argv.includes("--check");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["tools/website-crypto/entry.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  charset: "utf8",
  legalComments: "none",
  write: false,
});
const licenses = [
  ["@noble/post-quantum 0.5.4", "node_modules/@noble/post-quantum/LICENSE"],
  ["@noble/curves 2.0.1", "node_modules/@noble/curves/LICENSE"],
  ["@noble/hashes 1.8.0 and 2.0.1", "node_modules/@noble/hashes/LICENSE"],
  ["bech32 2.0.0", "node_modules/bech32/LICENSE"],
  ["esbuild 0.28.2", "node_modules/esbuild/LICENSE.md"],
];
const notices = [];
for (const [name, path] of licenses) {
  const license = await readFile(resolve(buildRoot, path), "utf8");
  notices.push(`===== ${name} =====\n${license.trimEnd()}`);
}
const artifacts = [
  ["website/vendor/crypto-deps.js", result.outputFiles[0].contents],
  ["website/vendor/CRYPTO-LICENSES.txt", Buffer.from(notices.join("\n\n") + "\n")],
];
for (const [name, content] of artifacts) {
  const path = resolve(root, name);
  if (check) {
    let current;
    try { current = await readFile(path); } catch { /* report missing output below */ }
    if (!current || !current.equals(Buffer.from(content))) {
      console.error(`${name} is missing or differs; run npm run build:website-crypto`);
      process.exitCode = 1;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    console.log(`Wrote ${name}`);
  }
}
