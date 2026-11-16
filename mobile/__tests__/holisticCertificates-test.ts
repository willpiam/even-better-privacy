const mockFiles=new Map<string,string>();
jest.mock('react-native-fs',()=>({
  readDir:async()=>Array.from(mockFiles.keys()).map(path=>({path,name:path.split('/').pop(),isFile:()=>true})),
  readFile:async(path:string)=>mockFiles.get(path),
}));
jest.mock('../src/services/atomicFile',()=>({writeFileAtomic:async(path:string,content:string)=>{mockFiles.set(path,content);}}));
jest.mock('../src/ebpCore',()=>({decodeHierarchyCertificate:(certificate:string)=>({masterFingerprint:'master',childFingerprint:certificate,timestamp:1,expiry:0,context:'test'})}));
jest.mock('../src/services/storage',()=>({ensureAppDirs:async()=>{},getCertificatesDir:()=>'/certificates'}));
jest.mock('../src/services/settings',()=>({getServerUrl:async()=>'https://keys.example.test'}));
import {publishCertificate,listCertificates} from '../src/services/hierarchy';

test('distinct accepted certificates saved in one millisecond are retained and duplicate saves are idempotent',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=jest.fn(async()=>({ok:true})) as never;
  jest.spyOn(Date,'now').mockReturnValue(42);
  try {
    await Promise.all([publishCertificate({certificate:'first'}),publishCertificate({certificate:'second'}),publishCertificate({certificate:'first'})]);
    expect(mockFiles.size).toBe(2);
    expect((await listCertificates()).map(record=>record.certificate).sort()).toEqual(['first','second']);
  } finally {globalThis.fetch=originalFetch;jest.restoreAllMocks();}
});
