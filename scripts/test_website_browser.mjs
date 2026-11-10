import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "website");
const fixture = spawnSync("python3", ["-c", `
import json
from ebp_core import Identity, ML_DSA_44, ML_KEM_512, sha256
message = "Browser interoperability check ☃"
salt = "browser-test"
with Identity.from_variants(ML_DSA_44, ML_KEM_512) as signer:
    identity = signer.public_data()
    payload = {"type": "ebp-signed-message", "version": 2,
               "fingerprint": identity["fingerprint"], "message": message,
               "messageHash": sha256(message.encode()).hex(), "salt": salt,
               "signature": signer.sign(message, salt), "identity": identity}
    print(json.dumps(payload))
`], { cwd: root, env: { ...process.env, PYTHONPATH: resolve(root, "python") }, encoding: "utf8" });
if (fixture.status !== 0) throw new Error(`Could not create browser fixture: ${fixture.stderr}`);
const payload = JSON.parse(fixture.stdout);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  if (request.url === "/api/v1/verify-signature") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"verified":true}');
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = resolve(site, `.${pathname}`);
  if (!file.startsWith(site + sep)) { response.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.EBP_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("https://**", (route) => route.abort());
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/verify.html`);
  await page.locator("#server-url").fill(origin);
  await page.locator("#payload-json").fill(JSON.stringify(payload));
  await page.locator("#verify-btn").click();
  await page.waitForFunction(() => document.querySelector("#result-summary").textContent.includes("Signature is valid"));
  const valid = JSON.parse(await page.locator("#result-json code").textContent());
  assert.equal(valid.verified, true);
  assert.equal(valid.verifiedBy, "client");
  assert.equal(valid.signerFingerprint, payload.fingerprint);
  await page.locator("#payload-json").fill(JSON.stringify({ ...payload, message: "tampered" }));
  await page.locator("#verify-btn").click();
  await page.waitForFunction(() => document.querySelector("#result-summary").textContent.includes("Signature is INVALID"));
  const tampered = JSON.parse(await page.locator("#result-json code").textContent());
  assert.equal(tampered.verified, false);
  assert.equal(tampered.serverConsistent, false);
  assert(requests.some((url) => url === `${origin}/vendor/crypto-deps.js`));
  assert(!requests.some((url) => url.includes("esm.sh")));
  console.log("Browser verified a C-signed message and rejected tampering using the local bundle");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
