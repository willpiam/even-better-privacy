import React from 'react';
import {BackHandler, ScrollView} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import MailAccountsScreen from '../src/screens/mail/MailAccountsScreen';
import AppButton from '../src/components/AppButton';
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
const navigation = {navigate: jest.fn(), setOptions: jest.fn()};
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

  function headerButton() {
    return navigation.setOptions.mock.lastCall![0].headerRight?.();
  }

  async function toggleMenu() {
    const button = headerButton();
    expect(button.props.accessibilityLabel).toBe('Add mail account');
    await act(async () => button.props.onPress());
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
    jest.restoreAllMocks();
  });

  it.each([
    ['mail-add-account', ['MailAccountSetup', {}]],
    ['mail-onboarding', ['OnboardingWizard']],
  ] as const)(
    'keeps %s directly available with no accounts',
    async (id, target) => {
      await renderAccounts(false);
      expect(headerButton()).toBeUndefined();
      expect(
        tree.root.findAllByType(AppButton).map(node => node.props.title),
      ).toEqual(
        expect.arrayContaining(['Add account', 'Create an EBP email address']),
      );
      await pressAction(id);
      expect(navigation.navigate).toHaveBeenCalledWith(...target);
    },
  );

  it.each([
    ['mail-add-account', ['MailAccountSetup', {}]],
    ['mail-onboarding', ['OnboardingWizard']],
  ] as const)(
    'opens %s from the + menu when an account exists',
    async (id, target) => {
      await renderAccounts(true);
      expect(
        tree.root.findAllByProps({testID: 'mail-add-account'}),
      ).toHaveLength(0);
      expect(
        tree.root.findAllByProps({testID: 'mail-onboarding'}),
      ).toHaveLength(0);
      expect(
        tree.root.findAllByType(AppButton).map(node => node.props.title),
      ).toContain('Open inbox');
      expect(headerButton().props.accessibilityState.expanded).toBe(false);

      await toggleMenu();
      expect(headerButton().props.accessibilityState.expanded).toBe(true);
      expect(
        tree.root.findByType(ScrollView).props.accessibilityElementsHidden,
      ).toBe(true);
      expect(
        tree.root.findAllByProps({testID: 'mail-add-account'}).length,
      ).toBeGreaterThan(0);
      expect(
        tree.root.findAllByProps({testID: 'mail-onboarding'}).length,
      ).toBeGreaterThan(0);
      await pressAction(id);

      expect(navigation.navigate).toHaveBeenCalledWith(...target);
      expect(
        tree.root.findAllByProps({testID: 'mail-menu-dismiss'}),
      ).toHaveLength(0);
      expect(headerButton().props.accessibilityState.expanded).toBe(false);
    },
  );

  it('dismisses on an outside tap or a second + tap', async () => {
    await renderAccounts(true);
    await toggleMenu();
    await pressAction('mail-menu-dismiss');
    expect(tree.root.findAllByProps({testID: 'mail-onboarding'})).toHaveLength(
      0,
    );
    expect(
      tree.root.findByType(ScrollView).props.accessibilityElementsHidden,
    ).toBe(false);
    await toggleMenu();
    await toggleMenu();
    expect(tree.root.findAllByProps({testID: 'mail-onboarding'})).toHaveLength(
      0,
    );
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('closes the menu with Android Back and removes its back handler', async () => {
    await renderAccounts(true);
    let onBack!: () => boolean | null | undefined;
    const remove = jest.fn();
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_, handler) => {
        onBack = handler;
        return {remove};
      });
    await toggleMenu();
    act(() => {
      expect(onBack()).toBe(true);
    });
    expect(tree.root.findAllByProps({testID: 'mail-onboarding'})).toHaveLength(
      0,
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
