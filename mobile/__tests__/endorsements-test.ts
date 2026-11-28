const mockFiles = new Map<string, string>();

jest.mock('react-native-fs', () => ({
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles.keys()]
      .filter(path => path.startsWith(dir + '/'))
      .map(path => ({
        path,
        name: path.split('/').pop(),
        isFile: () => true,
      })),
  ),
  readFile: jest.fn(async (path: string) => mockFiles.get(path)),
  exists: jest.fn(async (path: string) => mockFiles.has(path)),
  stat: jest.fn(async (path: string) => ({
    size: mockFiles.get(path)?.length ?? 0,
  })),
}));
jest.mock('../src/services/atomicFile', () => ({
  writeFileAtomic: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
}));
jest.mock('../src/services/contacts', () => ({
  listContacts: jest.fn(async () => []),
  importScannedContact: jest.fn(async () => 'bob'),
}));
jest.mock('../src/services/storage', () => ({
  ensureAppDirs: jest.fn(async () => {}),
  getCertificatesDir: () => '/certificates',
  loadIdentityForUse: jest.fn(),
}));

import {Identity} from '../../core/Identity';
import {
  createVerificationOffer,
  signVerificationProof,
  VERIFICATION_SESSION_MS,
  withdrawEndorsement,
} from '../../core/PeerVerification';
import {importScannedContact, listContacts} from '../src/services/contacts';
import {
  createPeerProof,
  importEndorsement,
  listEndorsements,
  savePeerEndorsement,
} from '../src/services/endorsements';
import {loadIdentityForUse} from '../src/services/storage';

const alice = new Identity('dilithium', 'kyber');
const bob = new Identity('dilithium', 'kyber');
const offer = createVerificationOffer(alice.summary, 'Alice');
const peer = createVerificationOffer(bob.summary, 'Bob');
const proof = signVerificationProof(bob, peer, offer);

beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
  jest.mocked(loadIdentityForUse).mockResolvedValue(alice);
  jest.mocked(listContacts).mockResolvedValue([]);
});

test('saved endorsements only attach to the fingerprint that was checked', async () => {
  const local = {identityName: 'alice', offer, startedAt: Date.now()};
  await savePeerEndorsement(local, peer, proof, 'Bob');
  expect(importScannedContact).toHaveBeenCalledWith(peer.identity, 'Bob');
  expect(await listEndorsements(peer.identity.fingerprint)).toHaveLength(1);
  const replacement = new Identity('dilithium', 'kyber').summary;
  expect(await listEndorsements(replacement.fingerprint)).toHaveLength(0);
});

test('an imported signed withdrawal survives reimport and concurrent delivery of the old endorsement', async () => {
  const local = {identityName: 'alice', offer, startedAt: Date.now()};
  await savePeerEndorsement(local, peer, proof, 'Bob');
  const [bundle] = await listEndorsements();
  const withdrawn = withdrawEndorsement(alice, bundle);
  const original = JSON.stringify(bundle);
  await Promise.all([
    importEndorsement(JSON.stringify(withdrawn)),
    importEndorsement(original),
  ]);
  expect(await importEndorsement(original)).toEqual(withdrawn);
  expect(await listEndorsements()).toEqual([withdrawn]);
});

test('expired sessions and known revoked contacts cannot create endorsements', async () => {
  const expired = {
    identityName: 'alice',
    offer,
    startedAt: Date.now() - VERIFICATION_SESSION_MS,
  };
  await expect(createPeerProof(expired, peer)).rejects.toThrow(/expired/);
  await expect(
    savePeerEndorsement(expired, peer, proof, 'Bob'),
  ).rejects.toThrow(/expired/);
  jest
    .mocked(listContacts)
    .mockResolvedValue([
      {name: 'bob', contact: {...peer.identity, revoked: true}},
    ]);
  await expect(
    savePeerEndorsement(
      {...expired, startedAt: Date.now()},
      peer,
      proof,
      'Bob',
    ),
  ).rejects.toThrow(/revoked/);
  expect(importScannedContact).not.toHaveBeenCalled();
  expect(await listEndorsements()).toHaveLength(0);
});
