import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {AppState, type AppStateStatus} from 'react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../src/services/storage', () => ({listIdentities: jest.fn()}));
jest.mock('../src/services/settings', () => ({getServerUrl: jest.fn()}));
jest.mock('../src/services/details', () => ({getIdentityDetails: jest.fn()}));
jest.mock('../src/services/unlockSession', () => ({isUnlocked: jest.fn()}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: jest.fn(),
}));
jest.mock('../src/services/identityPublication', () => ({
  ...jest.requireActual('../src/services/identityPublication'),
  fetchIdentityPublication: jest.fn(),
}));

import {useIdentityProfile} from '../src/hooks/useIdentityProfile';
import {useIdentityUnlock} from '../src/hooks/useIdentityUnlock';
import {listIdentities} from '../src/services/storage';
import {getServerUrl} from '../src/services/settings';
import {getIdentityDetails} from '../src/services/details';
import {isUnlocked} from '../src/services/unlockSession';
import {fetchIdentityPublication} from '../src/services/identityPublication';
import type {IdentityPublication} from '../src/services/identityPublication';

const meta = {
  name: 'Alice',
  fingerprint: 'ebp-alice',
  signingKeyType: 'dilithium' as const,
  encryptionKeyType: 'kyber' as const,
};
let profile: ReturnType<typeof useIdentityProfile>;
let tree: renderer.ReactTestRenderer;
let onState: (state: AppStateStatus) => void;
const ensureUnlocked = jest.fn();
function Harness({name = 'Alice'}: {name?: string}) {
  profile = useIdentityProfile(name);
  return null;
}
async function mount() {
  await act(async () => {
    tree = renderer.create(<Harness />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listIdentities).mockResolvedValue([meta]);
  jest.mocked(getServerUrl).mockResolvedValue('https://keys.example');
  jest.mocked(isUnlocked).mockReturnValue(false);
  jest
    .mocked(getIdentityDetails)
    .mockResolvedValue({details: [], revokedPaths: [], revoked: false});
  jest
    .mocked(fetchIdentityPublication)
    .mockResolvedValue({state: 'unpublished'});
  jest
    .mocked(useIdentityUnlock)
    .mockReturnValue({ensureUnlocked, unlockPrompt: <></>});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    onState = cb;
    return {remove: jest.fn()};
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

it('loads public status without prompting to unlock or reading encrypted details', async () => {
  await mount();
  expect(profile.identity).toEqual(meta);
  expect(profile.publication.state).toBe('unpublished');
  expect(ensureUnlocked).not.toHaveBeenCalled();
  expect(getIdentityDetails).not.toHaveBeenCalled();
});
it('reads local edits when already unlocked', async () => {
  jest.mocked(isUnlocked).mockReturnValue(true);
  const detail = {path: 'email', detail: 'edited@example.com', proof: 'proof'};
  jest
    .mocked(getIdentityDetails)
    .mockResolvedValue({details: [detail], revokedPaths: [], revoked: false});
  await mount();
  expect(profile.details).toEqual([detail]);
});
it('treats offline status as unknown and rechecks after returning from email verification', async () => {
  jest
    .mocked(fetchIdentityPublication)
    .mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(profile.publication.state).toBe('unavailable');
  await act(async () => onState('active'));
  expect(profile.publication.state).toBe('unpublished');
  expect(fetchIdentityPublication).toHaveBeenCalledTimes(2);
});
it('discards a late response from the previously selected server', async () => {
  let finish!: (value: IdentityPublication) => void;
  jest.mocked(fetchIdentityPublication).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  expect(profile.publication.state).toBe('checking');
  jest.mocked(getServerUrl).mockResolvedValue('https://other.example');
  await act(async () => {
    await profile.refresh();
  });
  expect(profile.serverUrl).toBe('https://other.example');
  await act(async () => {
    finish({state: 'unavailable', message: 'Old response'});
  });
  expect(profile.publication.state).toBe('unpublished');
});
it('does not retain a previously displayed success if a later check fails', async () => {
  jest.mocked(fetchIdentityPublication).mockResolvedValueOnce({
    state: 'published',
    identity: {
      ...meta,
      signingKey: 's',
      encryptionKey: 'e',
      signingKeyDetails: {variant: 'ml_dsa87'},
      encryptionKeyDetails: {variant: 'ml_kem1024'},
      details: {},
    },
  });
  await mount();
  expect(profile.publication.state).toBe('published');
  jest
    .mocked(fetchIdentityPublication)
    .mockRejectedValueOnce(new Error('Offline'));
  await act(async () => {
    await profile.refresh();
  });
  expect(profile.publication.state).toBe('unavailable');
});

it('keeps locally revoked emails out of the server-backed summary', async () => {
  jest.mocked(isUnlocked).mockReturnValue(true);
  jest
    .mocked(getIdentityDetails)
    .mockResolvedValue({details: [], revokedPaths: ['email'], revoked: false});
  jest.mocked(fetchIdentityPublication).mockResolvedValue({
    state: 'published',
    identity: {
      ...meta,
      signingKey: 's',
      encryptionKey: 'e',
      signingKeyDetails: {variant: 'ml_dsa87'},
      encryptionKeyDetails: {variant: 'ml_kem1024'},
      details: {email: ['revoked@example.com', 'proof']},
      detailsMeta: {email: {verified: true, verifiedAt: 1}},
    },
  });
  await mount();
  expect(profile.details).toEqual([]);
});
