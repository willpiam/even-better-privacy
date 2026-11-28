const mockFiles=new Map<string,string>();
jest.mock('react-native-fs',()=>({
  readDir:jest.fn(async()=>Array.from(mockFiles.keys()).map(path=>({path,name:path.split('/').pop(),isFile:()=>true}))),
  readFile:jest.fn(async(path:string)=>mockFiles.get(path)),
  exists:jest.fn(async(path:string)=>mockFiles.has(path)),
}));
jest.mock('../src/services/atomicFile',()=>({writeFileAtomic:jest.fn(async(path:string,content:string)=>{mockFiles.set(path,content);})}));
jest.mock('../src/services/storage',()=>({ensureAppDirs:async()=>{},getContactsDir:()=>'/contacts'}));
jest.mock('../src/services/settings',()=>({getServerUrl:async()=>'https://keys.example.test'}));
import RNFS from 'react-native-fs';
import {Identity} from '../../core/Identity';
import {sha256Hex} from '../../core/MessageHash';
import {findContactsByEmail,resolveVerifiedRecipient,listContacts,importScannedContact} from '../src/services/contacts';
import {writeFileAtomic} from '../src/services/atomicFile';

const email='match@example.test';
function seed(count:number,claim:string) {
  mockFiles.clear();
  const identity=new Identity('dilithium','kyber');
  for(let index=0;index<count;index++)mockFiles.set(`/contacts/contact-${index}.json`,JSON.stringify({...identity.summary,details:{'opaque::email':[sha256Hex(claim),'proof']}}));
  jest.clearAllMocks();
}

test('opaque-email cache persistence uses linear reads from one directory snapshot',async()=>{
  const count=20;seed(count,email);
  expect((await findContactsByEmail(email)).length).toBe(count);
  expect(RNFS.readDir).toHaveBeenCalledTimes(1);
  expect(RNFS.readFile).toHaveBeenCalledTimes(count*2);
  expect(writeFileAtomic).toHaveBeenCalledTimes(count);
  for(const raw of mockFiles.values())expect(JSON.parse(raw).resolvedOpaqueDetails['opaque::email']).toBe(email);
});

test('a server miss does not reread the contact directory, and damaged neighbors stay isolated',async()=>{
  seed(20,'other@example.test');
  const oldFetch=globalThis.fetch;
  globalThis.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({identities:[]})})) as never;
  try {
    expect(await resolveVerifiedRecipient(email)).toEqual({status:'none'});
    expect(RNFS.readDir).toHaveBeenCalledTimes(1);
    expect(RNFS.readFile).toHaveBeenCalledTimes(20);
    mockFiles.set('/contacts/broken.json','{');
    const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
    try {expect(await listContacts()).toHaveLength(20);}finally {warn.mockRestore();}
  } finally {globalThis.fetch=oldFetch;}
});

test('QR imports are idempotent and preserve existing contact revocations', async () => {
  mockFiles.clear();
  const {summary} = new Identity('dilithium', 'kyber');
  const [first, second] = await Promise.all([
    importScannedContact(summary, 'Alice'),
    importScannedContact(summary, 'Second alias', email),
  ]);
  expect(first).toBe(second);
  expect(mockFiles.size).toBe(1);
  expect((await listContacts())[0].localAlias).toBe('Alice');
  expect((await findContactsByEmail(email))[0].localEmail).toBe(email);
  await importScannedContact(summary, 'Third alias', 'other@example.test');
  expect((await listContacts())[0].localEmail).toBe(email);

  mockFiles.clear();
  const original = JSON.stringify({...summary, revoked: true, localAlias: 'Existing alias'});
  mockFiles.set('/contacts/existing.json', original);
  expect(await importScannedContact(summary, 'Scanned alias', email)).toBe('existing');
  expect(mockFiles.size).toBe(1);
  expect(mockFiles.get('/contacts/existing.json')).toBe(original);
});

test('QR import rejects a supplied fingerprint that differs from the keys', async () => {
  mockFiles.clear();
  const {summary} = new Identity('dilithium', 'kyber');
  const fingerprint = new Identity('dilithium', 'kyber').toFingerprint();

  await expect(
    importScannedContact({...summary, fingerprint}, 'Alice', email),
  ).rejects.toThrow(/fingerprint mismatch/);
  expect(mockFiles.size).toBe(0);
});
