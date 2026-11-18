import React from 'react';
import renderer, {act} from 'react-test-renderer';
import MailAccountsScreen from '../src/screens/mail/MailAccountsScreen';
import AppButton from '../src/components/AppButton';
import ListRow from '../src/components/ListRow';
import PlaceHeader from '../src/components/PlaceHeader';
import {
  readMailStore,
  getMailSecretsInMemory,
  getMailSecretsStatus,
} from '../src/services/mail/accountStore';
import {useIdentityUnlock} from '../src/hooks/useIdentityUnlock';
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
  resolveSelectedAccountId: jest.requireActual(
    '../src/services/mail/accountStoreLogic',
  ).resolveSelectedAccountId,
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
  useIdentityUnlock: jest.fn(() => ({
    ensureUnlocked: async () => false,
    unlockPrompt: null,
  })),
}));
jest.mock('../src/hooks/useSecretPrompt', () => ({
  useSecretPrompt: () => ({promptSecret: jest.fn(), secretPrompt: null}),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
const navigation = {navigate: jest.fn()};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useIdentityUnlock).mockReturnValue({
    ensureUnlocked: async () => null,
    unlockPrompt: null as never,
  });
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
      jest.mocked(readMailStore).mockResolvedValue({
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
          navigation={navigation as never}
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

it('prompts before server lookup completes', async () => {
  const ensureUnlocked = jest.fn(async () => null);
  jest
    .mocked(useIdentityUnlock)
    .mockReturnValue({ensureUnlocked, unlockPrompt: null as never});
  jest
    .mocked(getMailSecretsStatus)
    .mockResolvedValue({locked: true, inMemory: false});
  jest
    .mocked(lookupVerifiedManagedEmail)
    .mockReturnValue(new Promise(() => {}));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MailAccountsScreen
        navigation={navigation as never}
        route={{key: 'accounts', name: 'MailAccounts'}}
      />,
    );
  });
  expect(ensureUnlocked).toHaveBeenCalledTimes(1);
  expect(ensureUnlocked).toHaveBeenCalledWith('Personal');
  await act(async () => tree.unmount());
});

describe('account creation actions', () => {
  let tree: renderer.ReactTestRenderer;

  async function renderAccounts(hasAccount: boolean) {
    if (hasAccount) {
      jest.mocked(readMailStore).mockResolvedValue({
        accounts: [
          {id: 'mail', name: 'Mail', config: {fromEmail: 'me@example.com'}},
        ],
        selectedAccountId: 'mail',
      } as never);
      jest
        .mocked(getMailSecretsInMemory)
        .mockReturnValue({imapPassword: 'secret', smtpPassword: 'secret'});
    }
    await act(async () => {
      tree = renderer.create(
        <MailAccountsScreen
          navigation={navigation as never}
          route={{key: 'accounts', name: 'MailAccounts'}}
        />,
      );
    });
  }

  async function pressAction(testID: string) {
    const button = tree.root.findAll(
      node =>
        node.props.testID === testID &&
        typeof node.props.onPress === 'function',
    )[0];
    await act(async () => button.props.onPress());
  }

  afterEach(async () => {
    await act(async () => tree.unmount());
  });

  it.each([
    ['mail-add-account', ['MailAccountSetup', {}]],
    ['mail-onboarding', ['OnboardingWizard']],
  ] as const)(
    'keeps %s directly available with no accounts',
    async (id, target) => {
      await renderAccounts(false);
      expect(
        tree.root.findAllByType(AppButton).map(node => node.props.title),
      ).toEqual(
        expect.arrayContaining(['Add account', 'Create an EBP email address']),
      );
      await pressAction(id);
      expect(navigation.navigate).toHaveBeenCalledWith(...target);
    },
  );

  it('shows the active mailbox address and opens the inbox without an account list', async () => {
    await renderAccounts(true);
    expect(readMailStore).toHaveBeenCalledWith('Personal');
    expect(tree.root.findByType(PlaceHeader).props).toMatchObject({
      eyebrow: 'CURRENT IDENTITY · Personal',
      subtitle: 'me@example.com',
    });
    expect(tree.root.findAllByType(ListRow)).toHaveLength(0);
    const buttons = tree.root.findAllByType(AppButton);
    expect(buttons.map(button => button.props.title)).toEqual(['Open inbox']);
    await act(async () => buttons[0].props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('MailInbox');
  });
});
