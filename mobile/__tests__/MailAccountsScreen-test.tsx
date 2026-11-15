import React from 'react';
import renderer, {act} from 'react-test-renderer';
import MailAccountsScreen from '../src/screens/mail/MailAccountsScreen';
import AppButton from '../src/components/AppButton';
import {
  readMailStore,
  getMailSecretsInMemory,
  getMailSecretsStatus,
} from '../src/services/mail/accountStore';
import {lookupVerifiedManagedEmail} from '../src/services/mail/ebpSignup';
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentityRequired: async () => 'Personal',
  readCurrentIdentityPublic: async () => ({
    name: 'Personal',
    publicData: {fingerprint: 'fp'},
  }),
}));
jest.mock('../src/services/mail/accountStore', () => ({
  readMailStore: jest.fn(),
  getMailSecretsStatus: jest.fn(),
  getMailSecretsInMemory: jest.fn(),
}));
jest.mock('../src/services/mail/ebpSignup', () => ({
  fetchEbpSignupConfig: async () => ({enabled: true, domain: 'example.com'}),
  lookupVerifiedManagedEmail: jest.fn(),
}));
jest.mock('../src/services/settings', () => ({
  getServerUrl: async () => 'https://example.com',
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: () => ({
    ensureUnlocked: async () => false,
    unlockPrompt: null,
  }),
}));
jest.mock('../src/hooks/useSecretPrompt', () => ({
  useSecretPrompt: () => ({promptSecret: jest.fn(), secretPrompt: null}),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
beforeEach(() => {
  jest
    .mocked(readMailStore)
    .mockResolvedValue({accounts: [], selectedAccountId: null});
  jest
    .mocked(getMailSecretsStatus)
    .mockResolvedValue({locked: false, inMemory: false});
  jest.mocked(lookupVerifiedManagedEmail).mockResolvedValue('me@example.com');
  jest.mocked(getMailSecretsInMemory).mockReturnValue(null);
});
it.each([
  ['missing account', true, false, true],
  ['working account', true, true, false],
  ['no verified mailbox', false, false, false],
] as const)(
  'shows restore only when needed: %s',
  async (_, verified, local, expected) => {
    jest
      .mocked(lookupVerifiedManagedEmail)
      .mockResolvedValue(verified ? 'me@example.com' : null);
    if (local) {
      jest
        .mocked(readMailStore)
        .mockResolvedValue({
          accounts: [
            {id: 'mail', name: 'Mail', config: {fromEmail: 'me@example.com'}},
          ],
          selectedAccountId: 'mail',
        } as never);
      jest
        .mocked(getMailSecretsInMemory)
        .mockReturnValue({imapPassword: 'secret', smtpPassword: 'secret'});
    }
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <MailAccountsScreen
          navigation={{navigate: jest.fn()} as never}
          route={{key: 'accounts', name: 'MailAccounts'}}
        />,
      );
    });
    const titles = tree.root
      .findAllByType(AppButton)
      .map(node => node.props.title);
    expect(titles.includes('Restore mailbox access')).toBe(expected);
    expect(titles).not.toContain('Mail help');
    await act(async () => tree.unmount());
  },
);
