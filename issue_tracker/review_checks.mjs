// Reproduce recorded flaws against the actual source, without mobile dependencies.
// Node 24+: node issue_tracker/review_checks.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

function load(relative, names, dependencies = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const stripped = stripTypeScriptTypes(source)
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport /g, '');
  const context = vm.createContext({Buffer, ...dependencies});
  vm.runInContext(`${stripped}\nglobalThis.result = {${names.join(',')}};`, context);
  return context.result;
}

const headers = load('mobile/src/services/mail/imapFetchBody.ts',
  ['parseHeaderField', 'readFetchRfc822Source'],
  {MAX_MAIL_SOURCE_BYTES: 20 * 1024 * 1024, decodeHeaderWords: x => x});
assert.equal(headers.parseHeaderField('Subject:\r\nFrom: alice@example.com\r\n\r\nBody', 'Subject'),
  'From: alice@example.com'); // Expected: empty subject.
console.log('Confirmed: empty Subject consumes From field');

const lines = ['* 1 FETCH (BODY[] "hello")', 'a1 NO server says OK later'];
assert.equal(await headers.readFetchRfc822Source({readLine: async () => lines.shift()}, 'a1'), 'hello');
console.log('Confirmed: tagged NO containing " OK" is treated as success');

const mime = load('mobile/src/services/mail/mime.ts', ['extractTextFromMimeSource']);
assert.equal(mime.extractTextFromMimeSource(
  'Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: base64\r\n\r\nY2Fm6Q==').text,
  'caf\ufffd'); // Expected: café.
console.log('Confirmed: Latin-1 MIME text is corrupted by unconditional UTF-8 decoding');

let replies;
const client = {
  readLine: async () => {
    if (!replies.length) throw new Error('No more server replies; real socket waits until timeout');
    return replies.shift();
  },
  writeLine() {}, close() {},
};
const smtp = load('mobile/src/services/mail/smtp.ts', ['sendMimeMessage', 'parseRecipientAddresses'],
  {mailStub: async () => {}, connectMailLineClient: async () => client});
replies = ['220 ready', '250 EHLO', '334 username', '334 password', '235 authenticated',
  '250 sender accepted', '251 User not local; will forward'];
await assert.rejects(smtp.sendMimeMessage(
  {smtpSecure: true, username: 'sender@example.com'}, {smtpPassword: 'test'},
  'To: recipient@example.com\r\n\r\nhello', ['recipient@example.com']), /No more server replies/);
console.log('Confirmed: valid RCPT success 251 leaves SMTP waiting for another reply');

console.log('All four correctness reproductions confirmed. These checks document current bugs; update them when fixing the issues.');
