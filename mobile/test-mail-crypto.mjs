import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const root = fileURLToPath(new URL('.', import.meta.url));
const built = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export {Identity} from '../core/Identity'; export {parseEbpPayloadInput} from '../core/PayloadInput'; export {cryptoSource, cryptoScript} from './src/services/mail/mailCryptoDocument';`,
    resolveDir: root,
  },
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  nodePaths: [root + 'node_modules'],
  plugins: [
    {
      name: 'noble-aliases',
      setup(b) {
        b.onResolve(
          {filter: /^@noble\/(hashes|ciphers|post-quantum)\/[^.]+$/},
          a => ({path: root + 'node_modules/' + a.path + '.js'}),
        );
      },
    },
  ],
});
const module = {exports: {}};
runInNewContext(built.outputFiles[0].text, {
  module,
  exports: module.exports,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  btoa,
  atob,
  console,
});
const {Identity, parseEbpPayloadInput, cryptoSource, cryptoScript} =
  module.exports;
const sender = new Identity('dilithium', 'kyber');
const recipient = new Identity('dilithium', 'kyber');
const key = webcrypto.getRandomValues(new Uint8Array(32));
const raw = sender.toStorageFormatWithKey(
  key,
  webcrypto.getRandomValues(new Uint8Array(16)),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.request().url() === 'https://localhost/'
      ? route.fulfill({contentType: 'text/html', body: cryptoSource.html})
      : route.abort();
  });
  await page.addInitScript(() => {
    window.messages = [];
    window.ReactNativeWebView = {
      postMessage: s => window.messages.push(JSON.parse(s)),
    };
  });
  await page.goto('https://localhost/');
  await page.waitForFunction(() => window.messages.some(m => m.ready));
  const message = 'Hello <script>"</script> 🌳\u2028\u2029';
  const input = {
    raw,
    key: Array.from(key),
    contacts: [recipient.summary],
    message,
    sign: true,
    includePublicKeys: true,
  };
  for (const includePublicKeys of [true, false]) {
    await page.evaluate(() => {
      window.messages = [];
    });
    await page.evaluate(cryptoScript({...input, includePublicKeys}));
    const result = await page.evaluate(() =>
      window.messages.find(m => m.result || m.error),
    );
    assert.ok(result.result, JSON.stringify(result));
    const payload = parseEbpPayloadInput(result.result.armor);
    if (includePublicKeys) {
      assert.equal(payload.senderIdentity.fingerprint, sender.toFingerprint());
    } else {
      assert.equal(payload.senderIdentity, undefined);
    }
    for (const identity of [recipient, sender]) {
      const decrypted = identity.decryptAndVerifyMulti(payload, sender.summary);
      assert.equal(decrypted.message, message);
      assert.equal(decrypted.verified, true);
    }
  }
  await page.evaluate(cryptoScript({...input, key: Array(32).fill(0)}));
  assert.ok(await page.evaluate(() => window.messages.some(m => m.error)));
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.deepEqual(requests, ['https://localhost/']);
  console.log(
    'PASS: isolated browser encryption, sender and recipient decryption, special characters, wrong key, network isolation',
  );
} finally {
  await browser.close();
}
