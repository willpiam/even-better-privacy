import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {walletPayKind,sepoliaPayment,SEPOLIA_CHAIN_ID,cip30LovelaceAmount} from '../website/checkout-wallet.js';
const source=readFileSync(new URL('../website/checkout.js',import.meta.url),'utf8');
const start=source.replace(/^import .*;\s*$/m,'').slice(0,source.replace(/^import .*;\s*$/m,'').indexOf('$("refresh").addEventListener'));
const order={email:'alice@test.pqpost.com',status:'quoted',asset:'ETH',network:'ethereum-sepolia',assetUnit:'native',recipient:`0x${'1'.repeat(40)}`,amountAtomic:'10',message:'order',expiresAt:Date.now()+60000};
function page(current,ethereum) {
 const elements=new Map();
 const context=vm.createContext({location:{origin:'http://127.0.0.1:8789',hash:'',hostname:'127.0.0.1'},window:{ethereum},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},fetch:async()=>({ok:true,json:async()=>current()}),TextEncoder,URL,Date,SEPOLIA_CHAIN_ID,sepoliaPayment,walletPayKind,cip30LovelaceAmount});
 vm.runInContext(start+'\nglobalThis.actions={payEthereum,payCardano};',context);
 return context.actions;
}
let sends=0;
const wallet={request:async ({method})=>{
 if(method==='eth_requestAccounts')return [`0x${'2'.repeat(40)}`];
 if(method==='eth_sendTransaction'){sends++;throw Object.assign(new Error('response lost after broadcast'),{code:-32603});}
}};
await assert.rejects(page(()=>order,wallet).payEthereum(order),/outcome is unknown/);
assert.equal(sends,1);
sends=0;
await assert.rejects(page(()=>({...order,expiresAt:1}),wallet).payEthereum(order),/expired/);
assert.equal(sends,0);
let refreshes=0;
await assert.rejects(page(()=>++refreshes===1?order:{...order,expiresAt:1},wallet).payEthereum(order),/cannot be paid/);
assert.equal(sends,0);
assert.equal(walletPayKind({...order,expiresAt:1}),null);
assert.equal(sepoliaPayment(order,`0x${'2'.repeat(40)}`).data.startsWith('0x'),true);
assert.equal(cip30LovelaceAmount(3000000n),'1a002dc6c0');
console.log('Checkout rejects stale quotes and never replays a wallet send with an unknown outcome.');
