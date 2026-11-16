import {assert, assertEquals, assertRejects} from '@std/assert';
import {Identity} from '../../core/Identity.ts';
import {FILE_FORMAT_VERSIONS} from '../../core/version.ts';
import {readState,writeState} from '../utils.ts';
import {terminalText} from '../terminal.ts';
import {cmdListServerIdentities} from '../commands/server.ts';

async function cli(home:string,args:string[]) {
  const output=await new Deno.Command(Deno.execPath(),{args:['run','--allow-read','--allow-write','--allow-env','--allow-net',new URL('../main.ts',import.meta.url).pathname,'--home',home,...args],stdin:'null',stdout:'piped',stderr:'piped'}).output();
  return {code:output.code,stdout:new TextDecoder().decode(output.stdout),stderr:new TextDecoder().decode(output.stderr)};
}

Deno.test('JSON store locking serializes writers in separate CLI/GUI processes', async () => {
  const dir=await Deno.makeTempDir();
  try {
    const script=`import {updatePrivateJson} from ${JSON.stringify(new URL('../json-store.ts',import.meta.url).href)};for(let i=0;i<20;i++)await updatePrivateJson(Deno.args[0],()=>({count:0}),value=>{value.count++;});`;
    await Deno.writeTextFile(`${dir}/writer.ts`,script);
    const results=await Promise.all(Array.from({length:4},()=>new Deno.Command(Deno.execPath(),{args:['run','--allow-read','--allow-write',`${dir}/writer.ts`,`${dir}/store.json`],stdout:'piped',stderr:'piped'}).output()));
    for(const result of results)assertEquals(result.code,0,new TextDecoder().decode(result.stderr));
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/store.json`)),{count:80});
    assertEquals((await Deno.stat(`${dir}/store.json`)).mode! & 0o777,0o600);
  } finally {await Deno.remove(dir,{recursive:true});}
});

Deno.test('authenticated state cannot be downgraded by replacing it with legacy JSON', async () => {
  const dir=await Deno.makeTempDir();
  try {
    await writeState(dir,{currentIdentity:'alice',server:'https://keys.example.test'});
    await Deno.writeTextFile(`${dir}/state.json`,JSON.stringify({currentIdentity:'alice',server:'http://attacker.example.test'}));
    await assertRejects(()=>readState(dir),Error,'Unauthenticated legacy');
    await assertRejects(()=>writeState(dir,{currentIdentity:'alice',server:'http://attacker.example.test'}));
  } finally {await Deno.remove(dir,{recursive:true});}
});

Deno.test('CLI rejects unsupported path hardening, truncated numeric options, and obsolete payloads', async () => {
  const home=await Deno.makeTempDir();
  try {
    for(const path of ["m/ebp'/dilithium'/0'/0/7'","m/ebp'/0/0'/0/7","m/ebp'/dilithium'/0'/0'/7"]) {
      const result=await cli(home,['hd','derive','--path',path,'--out','test']);
      assert(result.code!==0);assert(result.stderr.includes('hardening')||result.stderr.includes('hardened'));
    }
    for(const value of ['1e3','7garbage','3.9'])assert((await cli(home,['hd','generate-mnemonic','--strength',value])).code!==0);
    for(const text of ['{"type":"ebp-signed-message","version":0}', '{"type":"ebp-signed-message","version":2,"version":2}']) {
      await Deno.writeTextFile(`${home}/payload.json`,text);
      assert((await cli(home,['verify',`${home}/payload.json`])).code!==0);
    }
  } finally {await Deno.remove(home,{recursive:true});}
});

Deno.test('CLI authenticated decryption fails with nonzero status and no plaintext when verification fails', async () => {
  const home=await Deno.makeTempDir();
  try {
    const recipient=new Identity('dilithium','kyber'),sender=new Identity('dilithium','kyber'),attacker=new Identity('dilithium','kyber');
    const dir=`${home}/.ebp`;await Deno.mkdir(`${dir}/contacts`,{recursive:true});
    const password='Regression-password-123';
    await Deno.writeTextFile(`${dir}/recipient.identity.json`,recipient.toStorageFormat(password));
    await writeState(dir,{currentIdentity:'recipient'});
    await Deno.writeTextFile(`${dir}/contacts/sender.json`,JSON.stringify(sender.summary));
    const message='unverified plaintext sentinel';
    await Deno.writeTextFile(`${home}/encrypted.json`,JSON.stringify({type:'ebp-encrypted-signed-message',version:FILE_FORMAT_VERSIONS.encryptedSignedMessage,recipientFingerprint:recipient.toFingerprint(),senderFingerprint:sender.toFingerprint(),ciphertext:attacker.signAndEncryptFor(message,recipient.summary)}));
    const result=await cli(home,['decrypt',`${home}/encrypted.json`,'--sender','sender','--password',password]);
    assert(result.code!==0);assert(!result.stdout.includes(message));
  } finally {await Deno.remove(home,{recursive:true});}
});

Deno.test('directory output escapes terminal controls at the renderer', async () => {
  assertEquals(terminalText('\x1b]0;title\x07\n'), '\\u001b]0;title\\u0007\\u000a');
  const oldFetch=globalThis.fetch,oldLog=console.log;const lines:string[]=[];
  try {
    globalThis.fetch=()=>Promise.resolve(Response.json({identities:[{fingerprint:'fingerprint\x1b[2J',signingKeyType:'dilithium',encryptionKeyType:'kyber',details:{'evil\npath':['value\x1b]52;c;data\x07','proof']}}]}));
    console.log=(...parts)=>{lines.push(parts.join(' '));};
    await cmdListServerIdentities({_:[]} as never,{server:'https://keys.example.test'} as never);
    assert(!lines.join('\n').includes('\x1b'));assert(!lines.join('\n').includes('\x07'));
    assert(lines.join('\n').includes('\\u001b'));
  } finally {globalThis.fetch=oldFetch;console.log=oldLog;}
});

Deno.test('CLI contact refresh retains attestation and revocation metadata while removing a changed opaque cache', async () => {
  const {cmdFetchIdentity}=await import('../commands/server.ts');
  const root=await Deno.makeTempDir();const oldFetch=globalThis.fetch;
  try {
    const identity=new Identity('dilithium','kyber');
    const ctx={identityDir:root,identityPath:`${root}/identity.json`,contactsDir:`${root}/contacts`,currentIdentity:'me',server:'https://keys.example.test'};
    await Deno.mkdir(ctx.contactsDir);
    const oldEmail='old@example.test';
    const hash=(await import('../../core/MessageHash.ts')).sha256Hex;
    await Deno.writeTextFile(`${ctx.contactsDir}/friend.json`,JSON.stringify({...identity.summary,localAlias:'Friend',details:{'opaque::email':[hash(oldEmail),'old-proof']},resolvedOpaqueDetails:{'opaque::email':oldEmail}}));
    const incoming={...identity.summary,details:{'opaque::email':[hash('new@example.test'),'new-proof']},detailsMeta:{'opaque::email':{verified:true,verifiedAt:2}},revoked:true,revokedDetails:['email'],revocationCertificate:'certificate'};
    globalThis.fetch=()=>Promise.resolve(Response.json(incoming));
    await cmdFetchIdentity({_: [identity.toFingerprint()],name:'friend'} as never,ctx);
    const saved=JSON.parse(await Deno.readTextFile(`${ctx.contactsDir}/friend.json`));
    for(const key of ['detailsMeta','revoked','revokedDetails','revocationCertificate'])assertEquals(saved[key],incoming[key as keyof typeof incoming]);
    assertEquals(saved.localAlias,'Friend');assertEquals(saved.resolvedOpaqueDetails,{});
  } finally {globalThis.fetch=oldFetch;await Deno.remove(root,{recursive:true});}
});
