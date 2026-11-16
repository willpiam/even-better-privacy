import {assert, assertEquals, assertRejects} from '@std/assert';
import {Identity} from '../../core/Identity.ts';
import {sha256Hex} from '../../core/MessageHash.ts';
import {PostgresDatabaseAdapter} from '../db/postgres.ts';
import type {DatabaseAdapter} from '../db/adapter.ts';
import {consumeNonce, ensureNewNonce, insertIdentity, insertDetail, issueDetailVerification, getDetailRecord, getIdentityDetailView} from '../db/index.ts';
import {handleRequestVerifyEmail} from '../verify-email.ts';
import {handlePostDetail} from '../handlers/identity.ts';
import {handleVerifiedEmailLookup, handleListIdentities} from '../handlers/discovery.ts';
import {EMAIL_VERIFY_REQUEST_PATH, verificationRequestDetail} from '../../common/MailVerification.ts';
import {checkCardanoPayment} from '../payments/verification.ts';

async function regressionDatabase(): Promise<DatabaseAdapter> {
  if (Deno.env.get('HOLISTIC_TEST_POSTGRES') === 'true') {
    const db = PostgresDatabaseAdapter.createFromEnv();
    await db.initializeSchema();
    return db;
  }
  const {SqliteDatabaseAdapter} = await import('../db/sqlite.ts');
  return new SqliteDatabaseAdapter(':memory:');
}
async function register(db: DatabaseAdapter, identity: Identity) {
  const row = identity.summary;
  await insertIdentity(db,{fingerprint:row.fingerprint,signingKeyType:row.signingKeyType,encryptionKeyType:row.encryptionKeyType,signingKey:row.signingKey,encryptionKey:row.encryptionKey,signingKeyDetails:row.signingKeyDetails,encryptionKeyDetails:row.encryptionKeyDetails,createdAt:Date.now()});
  return row.fingerprint;
}
function post(path: string, body: unknown) {return new Request(`http://localhost${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}

Deno.test('Cardano grants no entitlement from collateral returns or failed script outputs', () => {
  const hash='1'.repeat(64),block='2'.repeat(64);
  const payment={txHash:hash,transaction:{hash,block,block_height:1,valid_contract:true},outputs:[{address:'recipient',amount:[{unit:'lovelace',quantity:'10'}],collateral:true}],metadata:[{label:'674',json_metadata:{msg:['order']}}],canonicalBlockHash:block,latestHeight:3,assetUnit:'lovelace',expected:{recipient:'recipient',amount:10n,message:'order',confirmations:2}};
  assertEquals(checkCardanoPayment(payment),'invalid');
  assertEquals(checkCardanoPayment({...payment,outputs:[{...payment.outputs[0],collateral:false}]}),'confirmed');
  assertEquals(checkCardanoPayment({...payment,transaction:{...payment.transaction,valid_contract:false},outputs:[{...payment.outputs[0],collateral:false}]}),'invalid');
});

Deno.test('authorization nonces are consumed once, including when a different endpoint receives the proof', async () => {
  const db=await regressionDatabase();
  try {
    const identity=new Identity('dilithium','kyber');const fingerprint=await register(db,identity);
    const outcomes=await Promise.all(Array.from({length:5},() => db.writeTransaction(tx => consumeNonce(tx,fingerprint,0),`identity:${fingerprint}`)));
    assertEquals(outcomes.filter(result => result.ok).length,1);
    assertEquals((await ensureNewNonce(db,fingerprint,0)).ok,false);
    identity.attachDetail('name','same nonce');
    const response=await handlePostDetail(post('/api/v1/detail',{fingerprint,path:'name',detail:'same nonce',proof:identity.summary.details.name[1]}),db);
    assertEquals(response.status,400);await response.body?.cancel();
    const reserved=identity.createDetailProof('ebp-mail::payment-order','payment');
    const replay=await handlePostDetail(post('/api/v1/detail',{fingerprint,path:'ebp-mail::payment-order',detail:'payment',proof:reserved}),db);
    assertEquals(replay.status,400);await replay.body?.cancel();
  } finally {await db.close();}
});

Deno.test('verification issuance preserves active tokens, authenticates resends, and bounds one recipient across identities', async () => {
  const db=await regressionDatabase();
  const previous=Deno.env.get('PUBLIC_BASE_URL');Deno.env.set('PUBLIC_BASE_URL','http://localhost');
  try {
    const identity=new Identity('dilithium','kyber');const fingerprint=await register(db,identity);
    const email='victim@example.test';identity.attachDetail('email',email);
    const proof=identity.summary.details.email[1];
    await insertDetail(db,{fingerprint,path:'email',detail:email,proof,createdAt:Date.now()});
    const now=Date.now(),recipientHash=sha256Hex(email);
    assert(await issueDetailVerification(db,{fingerprint,path:'email',detail:email,proof,token:null,tokenHash:'original',expiresAt:now+60000,sentAt:now,recipientHash}));
    const unauthorized=await handleRequestVerifyEmail(post('/api/v1/verify-email/request',{fingerprint,detail:email}),db);
    assertEquals(unauthorized.status,401);await unauthorized.body?.cancel();
    const authorization=identity.createDetailProof(EMAIL_VERIFY_REQUEST_PATH,verificationRequestDetail('email',email));
    const payload={fingerprint,detail:email,authorization};
    const authorized=await handleRequestVerifyEmail(post('/api/v1/verify-email/request',payload),db);
    assertEquals(authorized.status,202);await authorized.body?.cancel();
    const reused=await handleRequestVerifyEmail(post('/api/v1/verify-email/request',payload),db);
    assertEquals(reused.status,409);await reused.body?.cancel();
    assertEquals((await getDetailRecord(db,fingerprint,'email'))!.verification_token_hash,'original');
    const records=[];
    for(let index=0;index<4;index++) {
      const other=new Identity('dilithium','kyber');const fp=await register(db,other);
      other.attachDetail('email',email);const p=other.summary.details.email[1];
      await insertDetail(db,{fingerprint:fp,path:'email',detail:email,proof:p,createdAt:now});
      records.push({fingerprint:fp,path:'email',detail:email,proof:p,token:null,tokenHash:`token-${index}`,expiresAt:now+60000,sentAt:now,recipientHash});
    }
    const issued=await Promise.all(records.map(record => issueDetailVerification(db,record)));
    assertEquals(issued.filter(Boolean).length,2); // one original + two = daily recipient budget
  } finally {if(previous===undefined)Deno.env.delete('PUBLIC_BASE_URL');else Deno.env.set('PUBLIC_BASE_URL',previous);await db.close();}
});

Deno.test('exact verified-email lookup and summary projection omit proofs while retaining verification and ambiguity', async () => {
  const db=await regressionDatabase();
  try {
    for(let index=0;index<3;index++) {
      const identity=new Identity('dilithium','kyber');const fp=await register(db,identity);
      await insertDetail(db,{fingerprint:fp,path:'email',detail:index<2?'Alice@example.test':'other@example.test',proof:'x'.repeat(20000),createdAt:index});
      await db.query("UPDATE details SET verified_at = 1 WHERE identity_fingerprint = ?",[fp]);
    }
    const exact=await handleVerifiedEmailLookup(new URL('http://localhost/?email=alice%40example.test'),db);
    const body=await exact.json();assertEquals(body.identities.length,2);
    for(const row of body.identities) {assertEquals(row.details.email[1],'');assertEquals(row.detailsMeta.email.verified,true);}
    const page=await handleListIdentities(new URL('http://localhost/?view=summary&limit=100'),db);
    assert(!(await page.text()).includes('x'.repeat(100)));
    const fp=body.identities[0].fingerprint;
    assertEquals((await getIdentityDetailView(db,fp)).details.email[1].length,20000);
  } finally {await db.close();}
});

Deno.test('PostgreSQL never replays a statement or a transaction after a lost commit response', async () => {
  for(const transaction of [false,true]) {
    let writes=0,operations=0;
    const error=new Error('connection closed after commit');
    const client={queryArray:async(sql:string) => {
      if(sql==='INSERT example') {writes++;if(!transaction)throw error;}
      if(sql==='COMMIT'||sql==='ROLLBACK')throw error;
      return {rows:[]};
    },release(){},end:async()=>{}};
    const ctor = PostgresDatabaseAdapter as unknown as {openPool: () => unknown};
    const originalOpenPool = ctor.openPool;
    ctor.openPool = () => ({connect:async()=>client,end:async()=>{}});
    const adapter=Object.create(PostgresDatabaseAdapter.prototype) as PostgresDatabaseAdapter;
    (adapter as unknown as {pool:unknown}).pool={connect:async()=>client,end:async()=>{}};
    try {
      await assertRejects(() => transaction?adapter.writeTransaction(async tx=>{operations++;await tx.execute('INSERT example');}):adapter.execute('INSERT example'),Error,error.message);
      assertEquals(writes,1);if(transaction)assertEquals(operations,1);
    } finally {await adapter.close();ctor.openPool=originalOpenPool;}
  }
});

Deno.test('background payment reconciliation expires once and logs order and stage for each domain failure', async () => {
  const {reconcilePendingPayments}=await import('../handlers/mail-payment.ts');
  let expiries=0;const logs:unknown[][]=[];const oldError=console.error;
  const ids=Array.from({length:50},(_,index)=>`order-${index}`);
  const db={execute:async()=>{},close:async()=>{},writeTransaction:async()=>{throw new Error('unused transaction');},query:async(sql:string,params:unknown[]=[])=>{
    if(sql.includes("SET status = 'expired'")||sql.includes("SET status = 'manual_review'")){expiries++;return [];}
    if(sql.includes('SELECT order_id FROM mail_payment_orders'))return ids.map(id=>[id]);
    if(sql.includes('SELECT order_id, username'))return [[params[0],'alice','not-configured.example','fp','ETH','ethereum-sepolia','recipient','native',100,'1',18,'2000','message','pending',1,Date.now()+60000,Date.now()+120000,'1'.repeat(64),1,1,1]];
    return [];
  }};
  try {
    console.error=(...args:unknown[])=>{logs.push(args);};
    await reconcilePendingPayments(db as never);
    assertEquals(expiries,2);
    assertEquals(logs.length,50);
    for(let index=0;index<50;index++){
      const context=logs[index][1] as {orderId:string;stage:string};
      assert(ids.includes(context.orderId));assertEquals(context.stage,'configuration');
    }
  } finally {console.error=oldError;}
});
