import {assert, assertEquals, assertRejects} from '@std/assert';
import {Identity} from '../../../core/Identity.ts';
import {getContext} from '../../../cli/utils.ts';
import {saveExternalContact, listContacts, loadContact} from '../contacts.ts';
import {addPendingHierarchyLocal, readPendingHierarchyLocal, removePendingHierarchyLocal} from '../hierarchy-local.ts';
import {clearMailSecrets, getMailSecretsStore, unlockMailSecretsWithPin, saveMailSecretsStore, saveMailStore, mailSecretCache, DEFAULT_MAIL_ACCOUNT} from '../mail-account.ts';
import {readJson, MAX_BODY_SIZE} from '../http.ts';
import {parseMailSourceInWorker} from '../mail-imap.ts';
import {handleRequest} from '../routes.ts';
import {initSecurity, getCsrfToken} from '../security.ts';

Deno.test('contact repository isolates damaged neighbors and rejects traversal at production routes', async () => {
  const home = await Deno.makeTempDir();
  try {
    const ctx = await getContext(home);
    const identity = new Identity('dilithium','kyber');
    await saveExternalContact(ctx, identity.summary, 'alice');
    await Deno.writeTextFile(`${ctx.contactsDir}/broken.json`, '{');
    assertEquals((await listContacts(ctx)).map(row => row.name), ['alice']);
    assertEquals((await loadContact(ctx, identity.toFingerprint().slice(0,18))).fingerprint, identity.toFingerprint());
    await initSecurity({home,persist:false});
    for (const name of ['../escaped','/tmp/escaped','..\\escaped','x\u0000y']) {
      const response = await handleRequest(new Request('http://localhost:8787/api/v1/contacts/import', {method:'POST',headers:{host:'localhost:8787','x-ebp-csrf':getCsrfToken(),'content-type':'application/json'},body:JSON.stringify({home,name,contact:identity.summary})}));
      assertEquals(response.status,400);
      await response.body?.cancel();
    }
    const response = await handleRequest(new Request('http://localhost:8787/api/v1/contacts/import', {method:'POST',headers:{host:'localhost:8787','x-ebp-csrf':getCsrfToken(),'content-type':'application/json'},body:JSON.stringify({home,name:'forged',contact:{...identity.summary,fingerprint:'forged'}})}));
    assertEquals(response.status,400);
    await response.body?.cancel();
  } finally { await Deno.remove(home,{recursive:true}); }
});

Deno.test('pending proposal updates preserve all acknowledged additions and concurrent removals', async () => {
  const home = await Deno.makeTempDir();
  try {
    const ctx = await getContext(home);
    const results = await Promise.all(Array.from({length:20},(_,index) => addPendingHierarchyLocal(ctx,{masterFingerprint:`master-${index}`,childFingerprint:`child-${index}`,proposerFingerprint:'owner',certificate:'certificate',context:'test',expiry:0})));
    assertEquals(new Set(results.map(r => r.id)).size,20);
    assertEquals((await readPendingHierarchyLocal(ctx)).length,20);
    await Promise.all([removePendingHierarchyLocal(ctx,results[0].id),addPendingHierarchyLocal(ctx,{masterFingerprint:'last',childFingerprint:'last-child',proposerFingerprint:'owner',certificate:'certificate',context:'test',expiry:0})]);
    const final = await readPendingHierarchyLocal(ctx);
    assertEquals(final.length,20);
    assert(final.some(r => r.masterFingerprint === 'last'));
  } finally {await Deno.remove(home,{recursive:true});}
});

Deno.test('failed vault reads cannot initialize a cache, and session-only passwords survive save until lock', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/mail-account.secrets.json`;
    await Deno.writeTextFile(path,'{broken vault');
    const originalRead = Deno.readTextFile;
    Deno.readTextFile = ((name: string | URL, options?: Deno.ReadFileOptions) => String(name) === path
      ? Promise.reject(new Deno.errors.PermissionDenied('transient vault read failure')) : originalRead(name, options)) as typeof Deno.readTextFile;
    try {
      await assertRejects(() => unlockMailSecretsWithPin(dir,'password'),Deno.errors.PermissionDenied);
      await assertRejects(() => saveMailSecretsStore(dir,{}),Deno.errors.PermissionDenied);
      assertEquals(mailSecretCache.has(dir),false);
    } finally { Deno.readTextFile=originalRead; }

    await assertRejects(() => unlockMailSecretsWithPin(dir,'password'));
    assertEquals(mailSecretCache.has(dir),false);
    await assertRejects(() => getMailSecretsStore(dir));
    assertEquals(await Deno.readTextFile(path),'{broken vault');
    await Deno.remove(path);
    await saveMailStore(dir,{selectedAccountId:'session',accounts:[{id:'session',name:'Session',createdAt:1,updatedAt:1,config:{...DEFAULT_MAIL_ACCOUNT,persistSecrets:false}}]});
    const secrets = {session:{imapPassword:'session-imap',smtpPassword:'session-smtp'}};
    await saveMailSecretsStore(dir,secrets);
    assertEquals(await getMailSecretsStore(dir),secrets);
    await assertRejects(() => Deno.stat(path),Deno.errors.NotFound);
    clearMailSecrets(dir);
    assertEquals(await getMailSecretsStore(dir),{});
  } finally {clearMailSecrets(dir);await Deno.remove(dir,{recursive:true});}
});

Deno.test('file request capacity is route-specific and accepts the declared 25 MiB representation', async () => {
  const data = btoa('x'.repeat(25 * 1024 * 1024));
  const file = await readJson(new Request('http://localhost/api/v1/encrypt-file',{method:'POST',body:JSON.stringify({fileDataBase64:data})}));
  assertEquals((file.fileDataBase64 as string).length,data.length);
  await assertRejects(() => readJson(new Request('http://localhost/api/v1/sign',{method:'POST',body:JSON.stringify({message:'x'.repeat(MAX_BODY_SIZE)})})));
});

Deno.test('GUI worker receives the original Latin-1 octets and the exact typed-array view', async () => {
  const {Buffer} = await import('node:buffer');
  const raw = Buffer.from('Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\ncaf\xe9','latin1');
  const backing = new Uint8Array(raw.length + 10);
  backing.set(raw,5);
  const result = await parseMailSourceInWorker(backing.subarray(5,raw.length+5),'message');
  assertEquals(String(result.text).trim(),'café');
});
