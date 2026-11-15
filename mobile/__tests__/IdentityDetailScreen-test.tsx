import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

jest.mock('../src/hooks/useIdentityProfile', () => ({
  useIdentityProfile: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/hooks/useSecretPrompt', () => ({
  useSecretPrompt: () => ({promptSecret: jest.fn(), secretPrompt: null}),
}));
jest.mock('../src/services/storage', () => ({
  deleteIdentity: jest.fn(),
  readIdentityRaw: jest.fn(),
}));
jest.mock('../src/services/contacts', () => ({requestVerifyEmail: jest.fn()}));
jest.mock('../src/services/publish', () => ({publishIdentity: jest.fn()}));
jest.mock('../src/services/details', () => ({
  addDetail: jest.fn(),
  publishDetail: jest.fn(),
}));
jest.mock('../src/services/revocation', () => ({
  generateEmergencyCert: jest.fn(),
  revokeDetail: jest.fn(),
  revokeIdentity: jest.fn(),
}));
jest.mock('../src/services/signVerify', () => ({
  exportPublicIdentity: jest.fn(),
}));
jest.mock('../src/services/identity', () => ({
  enforceAtLeastOneExportKey: jest.fn(),
  resolveOpaqueDetailPath: jest.fn(),
}));
jest.mock('react-native-share', () => ({open: jest.fn()}));
jest.mock('@react-native-clipboard/clipboard', () => ({setString: jest.fn()}));

import IdentityDetailScreen from '../src/screens/IdentityDetailScreen';
import IdentityActionsScreen from '../src/screens/IdentityActionsScreen';
import {useIdentityProfile} from '../src/hooks/useIdentityProfile';
import {requestVerifyEmail} from '../src/services/contacts';
import {publishDetail} from '../src/services/details';
import type {IdentityPublication} from '../src/services/identityPublication';

const navigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  goBack: jest.fn(),
};
const email = {path: 'email', detail: 'alice@example.com', proof: 'proof'};
const record = {
  fingerprint: 'ebp-alice',
  signingKeyType: 'dilithium' as const,
  encryptionKeyType: 'kyber' as const,
  signingKey: 'signing',
  encryptionKey: 'encryption',
  signingKeyDetails: {variant: 'ml_dsa87'},
  encryptionKeyDetails: {variant: 'ml_kem1024'},
  details: {email: [email.detail, email.proof] as [string, string]},
  detailsMeta: {email: {verified: true, verifiedAt: 1}},
};
let profile: ReturnType<typeof useIdentityProfile>;
let tree: renderer.ReactTestRenderer;
const text = () =>
  tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
const has = (id: string) => tree.root.findAllByProps({testID: id}).length > 0;
const press = (id: string) =>
  tree.root
    .findAllByProps({testID: id})
    .find(n => typeof n.props.onPress === 'function')!
    .props.onPress();
async function mount(
  screen:
    | 'IdentityDetail'
    | 'IdentityPublish'
    | 'IdentityDetails'
    | 'IdentityExport'
    | 'IdentitySecurity' = 'IdentityDetail',
) {
  await act(async () => {
    tree = renderer.create(
      screen === 'IdentityDetail' ? (
        <IdentityDetailScreen
          navigation={navigation as never}
          route={{key: 'detail', name: screen, params: {identityName: 'Alice'}}}
        />
      ) : (
        <IdentityActionsScreen
          navigation={navigation as never}
          route={{key: screen, name: screen, params: {identityName: 'Alice'}}}
        />
      ),
    );
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  profile = {
    identity: {
      name: 'Alice',
      fingerprint: record.fingerprint,
      signingKeyType: 'dilithium',
      encryptionKeyType: 'kyber',
    },
    loading: false,
    serverUrl: 'https://keys.example',
    details: [email],
    localDetails: [email],
    locallyRevoked: false,
    sessionUnlocked: true,
    error: '',
    publication: {state: 'published', identity: record},
    refresh: jest.fn(async () => {}),
    unlock: jest.fn(async () => 'Alice'),
    ensureUnlocked: jest.fn(async () => 'Alice'),
    unlockPrompt: <></>,
  };
  jest.mocked(useIdentityProfile).mockImplementation(() => profile);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('shows completed publication and email checks without their action buttons or the old forms', async () => {
  await mount();
  expect(text()).toContain('✓ Published');
  expect(text()).toContain('✓ Email verified');
  for (const id of [
    'identity-open-publish',
    'identity-open-verify-email',
    'identity-detail-path',
    'identity-publish',
    'identity-delete',
    'identity-export-public',
  ])
    expect(has(id)).toBe(false);
  expect(has('identity-fingerprint')).toBe(true);
  expect(profile.ensureUnlocked).not.toHaveBeenCalled();
});
it.each([
  ['identity-open-details', 'IdentityDetails'],
  ['identity-open-export', 'IdentityExport'],
  ['identity-open-security', 'IdentitySecurity'],
])('opens the focused workflow from %s', async (id, destination) => {
  await mount();
  await act(async () => press(id));
  expect(navigation.navigate).toHaveBeenCalledWith(destination, {
    identityName: 'Alice',
  });
});
it('offers publication only when absence was confirmed on this server', async () => {
  profile.publication = {state: 'unpublished'};
  await mount();
  await act(async () => press('identity-open-publish'));
  expect(navigation.navigate).toHaveBeenCalledWith('IdentityPublish', {
    identityName: 'Alice',
  });
  expect(text()).not.toContain('✓ Email verified');
});
it.each<[IdentityPublication]>([
  [{state: 'checking'}],
  [{state: 'unavailable', message: 'Offline'}],
  [{state: 'revoked', identity: {...record, revoked: true}}],
])(
  'does not claim success or offer verification with status %j',
  async publication => {
    profile.publication = publication;
    await mount();
    expect(has('identity-open-publish')).toBe(false);
    expect(text()).not.toContain('✓ Email verified');
    expect(has('identity-open-verify-email')).toBe(false);
  },
);
it('shows email verification only for an unverified published address', async () => {
  profile.publication = {
    state: 'published',
    identity: {...record, detailsMeta: {}},
  };
  await mount();
  await act(async () => press('identity-open-verify-email'));
  expect(navigation.navigate).toHaveBeenCalledWith('IdentityDetails', {
    identityName: 'Alice',
  });
});
it.each(['IdentityPublish', 'IdentityDetails'] as const)(
  'hides the completed action inside %s too',
  async screen => {
    await mount(screen);
    expect(has('identity-publish')).toBe(false);
    expect(has('identity-verify-email')).toBe(false);
  },
);
it.each([
  ['IdentityDetails', 'identity-detail-path', 'identity-export-public'],
  ['IdentityExport', 'identity-export-public', 'identity-detail-path'],
  ['IdentitySecurity', 'identity-delete', 'identity-detail-path'],
] as const)('limits %s to its workflow', async (screen, present, absent) => {
  await mount(screen);
  expect(has(present)).toBe(true);
  expect(has(absent)).toBe(false);
});
it('publishes a changed email detail before offering verification', async () => {
  profile.details = [{...email, detail: 'changed@example.com'}];
  await mount('IdentityDetails');
  expect(has('identity-verify-email')).toBe(false);
  expect(text()).not.toContain('✓ Email verified');
  await act(async () => press('identity-publish-detail-email'));
  expect(publishDetail).toHaveBeenCalledWith({
    identityName: 'Alice',
    path: 'email',
    server: 'https://keys.example',
  });
  expect(requestVerifyEmail).not.toHaveBeenCalled();
  expect(profile.refresh).toHaveBeenCalled();
});

it('keeps a locally revoked identity out of the publication flow', async () => {
  profile.locallyRevoked = true;
  profile.publication = {state: 'unpublished'};
  profile.details = [];
  await mount();
  expect(text()).toContain('Identity revoked on this device');
  expect(has('identity-open-publish')).toBe(false);
  expect(text()).not.toContain('✓ Email verified');
});
