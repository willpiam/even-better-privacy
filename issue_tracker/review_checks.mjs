// Regression checks against the actual source, without native mobile dependencies.
// Node 24+: node issue_tracker/review_checks.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {splitHeadersAndBody} from '../common/mail/Headers.ts';
import {taggedImapStatus} from '../common/mail/ImapStatus.ts';
import {splitMailboxList} from '../common/mail/Mailbox.ts';

function load(relative, names, dependencies = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const stripped = stripTypeScriptTypes(source)
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport /g, '');
  const context = vm.createContext({Buffer, TextEncoder, TextDecoder, ...dependencies});
  vm.runInContext(`${stripped}\nglobalThis.result = {${names.join(',')}};`, context);
  return context.result;
}

const headers = load('mobile/src/services/mail/imapFetchBody.ts',
  ['parseHeaderField', 'readFetchRfc822Source'],
  {MAX_MAIL_SOURCE_BYTES: 20 * 1024 * 1024, decodeHeaderWords: x => x, splitHeadersAndBody, taggedImapStatus});
assert.equal(headers.parseHeaderField('Subject:\r\nFrom: alice@example.com\r\n\r\nBody', 'Subject'), '');
const lines = ['* 1 FETCH (BODY[] "hello")', 'a1 NO server says OK later'];
await assert.rejects(headers.readFetchRfc822Source({readLine: async () => lines.shift()}, 'a1'), /a1 NO/);

const mime = load('common/mail/Mime.ts', ['extractTextFromMimeSource'], {splitHeadersAndBody});
assert.equal(mime.extractTextFromMimeSource(
  'Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: base64\r\n\r\nY2Fm6Q==').text,
  'café');

let replies;
const client = {
  readLine: async () => {
    if (!replies.length) throw new Error('Unexpected extra SMTP read');
    return replies.shift();
  },
  writeLine() {}, close() {},
};
const smtp = load('mobile/src/services/mail/smtp.ts', ['sendMimeMessage'],
  {mailStub: async () => {}, connectMailLineClient: async () => client, splitMailboxList});
for (const recipientCode of ['250', '251', '252']) {
  replies = ['220 ready', '250 EHLO', '334 username', '334 password', '235 authenticated',
    '250 sender accepted', `${recipientCode} recipient accepted`, '354 send message', '250 queued'];
  await smtp.sendMimeMessage(
    {smtpSecure: true, username: 'sender@example.com'}, {smtpPassword: 'test'},
    'To: recipient@example.com\r\n\r\nhello', ['recipient@example.com']);
  assert.equal(replies.length, 0);
}
console.log('All four original review failures are fixed; corrected-behavior regressions passed.');
