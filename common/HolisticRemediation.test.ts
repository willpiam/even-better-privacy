import {assert, assertEquals, assertRejects, assertThrows} from '@std/assert';
import {Buffer} from 'node:buffer';
import {Identity} from '../core/Identity.ts';
import {bytesToBase64, base64ToBytes} from '../core/Base64.ts';
import {parseStrictJson} from '../core/StrictJson.ts';
import {buildFileSignMessage} from '../core/CryptoUtils.ts';
import {createEmailAttachmentCleartextEnvelope, parseEmailAttachmentCleartextEnvelope} from '../core/EmailAttachmentPayload.ts';
import {mergeContactRefresh, validateContact, validOpaqueResolutions} from './Contacts.ts';
import {sha256Hex} from '../core/MessageHash.ts';
import {matchFromToIdentity} from './MailAuthenticity.ts';
import {parseAddressList} from './ComposeRecipients.ts';
import {splitHeadersAndBody} from './mail/Headers.ts';
import {formatMailbox} from './mail/Mailbox.ts';
import {parseMimeMessage} from './mail/Mime.ts';
import {taggedImapStatus} from './mail/ImapStatus.ts';
import {normalizeServerUrl} from './ServerPolicy.ts';
import {identityIsPublished} from './Discovery.ts';
import {lookupVerifiedEmail} from './VerifiedEmailLookup.ts';
import {layoutHierarchyTree} from '../mobile/src/services/hierarchyLayout.ts';

Deno.test('mail headers preserve empty, folded, repeated fields and all accepted line endings', () => {
  for (const nl of ['\r\n','\n','\r']) {
    const source = ['Subject:', 'From: Alice <alice@example.test>', 'X-Value: first', '\tcontinued', 'X-Value: second', '', 'Subject: body'].join(nl);
    const parsed = splitHeadersAndBody(source);
    assertEquals(parsed.headers.subject, '');
    assertEquals(parsed.headers.from, 'Alice <alice@example.test>');
    assertEquals(parsed.fields.filter(f => f.name === 'x-value').map(f => f.value), ['first continued','second']);
    assertEquals(parsed.body, 'Subject: body');
  }
  assertEquals(taggedImapStatus('a1 NO server says OK later', 'a1'), 'NO');
  assertEquals(taggedImapStatus('a1 ok done', 'a1'), 'OK');
  assertEquals(taggedImapStatus('a10 OK done', 'a1'), null);
});

Deno.test('mailbox parsing and formatting round-trip commas, escapes, Unicode and multiple recipients', async () => {
  const input = `${formatMailbox('Doe, Jane', 'jane@example.test')}, ${formatMailbox('Dr. "Q"', 'q@example.test')}; ${formatMailbox('Élodie', 'e@example.test')}`;
  const expected = ['jane@example.test','q@example.test','e@example.test'].map(email => ({email, valid: true}));
  assertEquals(parseAddressList(input), expected);
  const mirror = await import('../gui/js/compose-recipients-logic.js');
  assertEquals(mirror.parseAddressList(input), expected);
});

Deno.test('MIME decodes Latin-1 raw, base64 and quoted-printable bytes before selecting body parts', () => {
  for (const [encoding, body] of [['8bit','caf\xe9'], ['base64','Y2Fm6Q=='], ['quoted-printable','caf=E9']]) {
    const source = Buffer.from(`Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${body}`, 'latin1');
    assertEquals(parseMimeMessage(source).text, 'café');
  }
  const source = 'Content-Type: multipart/mixed; boundary="valid boundary"\r\n\r\n--valid boundary\r\nContent-Type: text/plain\r\n\r\nMessage body\r\n--valid boundary\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="note.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nQVRUQUNITUVOVA==\r\n--valid boundary--';
  assertEquals(parseMimeMessage(source).text, 'Message body');
  const onlyAttachment = source.replace('Message body', '').replace('Content-Type: text/plain\r\n\r\n', 'Content-Type: application/octet-stream\r\n\r\n');
  assertEquals(parseMimeMessage(onlyAttachment), {text:'', html:'', ebpPayload:null});
});

Deno.test('contact refresh binds opaque resolutions to current claims and retains server metadata and local notes', () => {
  const identity = new Identity('dilithium', 'kyber').summary;
  const oldEmail = 'old@example.test';
  const existing = {...identity, localAlias:'My friend', details:{'opaque::email':[sha256Hex(oldEmail),'proof'] as [string,string]}, resolvedOpaqueDetails:{'opaque::email':oldEmail}};
  const fresh = {...identity, details:{'opaque::email':[sha256Hex('new@example.test'),'new-proof'] as [string,string]}, detailsMeta:{'opaque::email':{verified:true, verifiedAt:1}}, revokedDetails:[]};
  const merged = mergeContactRefresh(existing, fresh);
  assertEquals(merged.resolvedOpaqueDetails, {});
  assertEquals((merged as Record<string,unknown>).localAlias, 'My friend');
  assertEquals(merged.detailsMeta, fresh.detailsMeta);
  assertEquals(validOpaqueResolutions({...existing, revoked:true}), {});
  assertEquals(matchFromToIdentity({...fresh, resolvedOpaqueDetails:existing.resolvedOpaqueDetails}, oldEmail).matches, false);
  assertThrows(() => validateContact({...identity, fingerprint: 'attacker-claim'}));
  assertThrows(() => validateContact({...identity, signingKey: 'invalid'}));
});

Deno.test('empty attachment, large Base64, strict JSON and file signature contracts', () => {
  const envelope = createEmailAttachmentCleartextEnvelope({attachmentId:'empty',fileBytes:new Uint8Array(),fileName:'empty.txt'});
  assertEquals(parseEmailAttachmentCleartextEnvelope(JSON.stringify(envelope)).fileBytes, new Uint8Array());
  assertThrows(() => parseEmailAttachmentCleartextEnvelope(JSON.stringify({...envelope,fileSize:1})));
  const bytes = new Uint8Array(4 * 1024 * 1024 + 1).fill(173);
  assertEquals(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  assertEquals(base64ToBytes(bytesToBase64(bytes)), bytes);
  assertEquals(parseStrictJson('{"b":[1,true,null],"a":"😀"}'), {b:[1,true,null],a:'😀'});
  for (const source of ['{"a":1,"\\u0061":2}', '{"a":"\\ud800"}', '{"\\u0000":1}', '1e400']) assertThrows(() => parseStrictJson(source));
  assertThrows(() => buildFileSignMessage('abc123', 'deadbeef::changed', 'context'));
  assertEquals(buildFileSignMessage('abc123','deadbeef','context::with::colons'),'ebp::filehash::abc123::deadbeef::context::with::colons');
});

Deno.test('settings and discovery distinguish authoritative absence from failures', async () => {
  for (const url of ['http://keys.example.test','file:///tmp/key','https://user:secret@keys.example.test']) assertThrows(() => normalizeServerUrl(url));
  assertEquals(normalizeServerUrl('http://localhost:8787/'), 'http://localhost:8787');
  assertEquals(await identityIsPublished(new Response(null,{status:404})), false);
  assertEquals(await identityIsPublished(Response.json({error:'unknown subject'},{status:400})), false);
  for (const status of [429,500,503]) await assertRejects(() => identityIsPublished(new Response(null,{status})));
  const calls: string[] = [];
  const match = await lookupVerifiedEmail('https://keys.example.test','a@example.test', async input => {
    calls.push(String(input));
    return Response.json({identities:[{fingerprint:'a',details:{email:['a@example.test','']},detailsMeta:{email:{verified:true}}}]});
  });
  assertEquals(match, {status:'unique',fingerprint:'a'});
  assertEquals(calls.length, 1);
  assert(calls[0].includes('/by-verified-email?'));
});

Deno.test('GUI and mobile hierarchy BFS keeps descendants below their parents and handles wide trees', async () => {
  const code = await Deno.readTextFile(new URL('../gui/js/hierarchy.js', import.meta.url));
  const pure = code.slice(code.indexOf('function _layoutTree('), code.indexOf('\nexport function renderHierarchyTreeSVG'));
  const gui = new Function(`${pure}; return _layoutTree;`)();
  const nodes = ['root','child','grandchild','orphan', ...Array.from({length:2000},(_,i) => `sibling-${i}`)].map(fingerprint => ({fingerprint}));
  const relationships = [{masterFingerprint:'root',childFingerprint:'child'},{masterFingerprint:'child',childFingerprint:'grandchild'}, ...nodes.slice(4).map(n => ({masterFingerprint:'root',childFingerprint:n.fingerprint}))];
  const mobile = layoutHierarchyTree(nodes, relationships, ['root']);
  const browser = gui(nodes, relationships, ['root']);
  assertEquals(browser.positions, mobile.positions);
  assert(mobile.positions.get('root')!.y < mobile.positions.get('child')!.y);
  assert(mobile.positions.get('child')!.y < mobile.positions.get('grandchild')!.y);
});
