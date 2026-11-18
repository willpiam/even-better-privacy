import React from 'react';
import renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingWizardScreen from '../src/screens/OnboardingWizardScreen';
import AppButton from '../src/components/AppButton';
import TextField from '../src/components/TextField';
import {getMailTestMode} from '../src/services/settings';
import {
  checkEbpUsername,
  createTestPaymentOrder,
  fetchEbpSignupConfig,
  fetchPaymentOrderStatus,
  fetchTestPaymentAssets,
  signupEbpMailbox,
} from '../src/services/mail/ebpSignup';
import {
  PRODUCTION_KEY_SERVER,
  TEST_MAIL_DOMAIN,
} from '../src/services/mail/ebpSignupLogic';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/hooks/useSecretPrompt', () => ({
  useSecretPrompt: () => ({secretPrompt: null}),
}));
jest.mock('../src/components/FoxArt', () => ({
  __esModule: true,
  default: () => null,
  FoxMotion: () => null,
}));
jest.mock('@react-native-clipboard/clipboard', () => ({setString: jest.fn()}));
jest.mock('react-native-share', () => ({open: jest.fn()}));
jest.mock('../src/ebpCore', () => ({
  randomHex: jest.fn(),
  validatePassword: jest.fn(),
}));
jest.mock('../src/services/hd', () => ({
  createHdIdentity: jest.fn(),
  createHdMnemonic: jest.fn(),
}));
jest.mock('../src/services/publish', () => ({
  publishIdentity: jest.fn(async () => {}),
}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentity: async () => 'Personal',
}));
jest.mock('../src/services/mail/accountStore', () => ({readMailStore: jest.fn()}));
jest.mock('../src/services/settings', () => ({
  getServerUrl: async () => require('../src/config/constants').DEFAULT_SERVER_URL,
  getMailTestMode: jest.fn(async () => false),
}));
jest.mock('../src/services/mail/ebpSignup', () => ({
  fetchEbpSignupConfig: jest.fn(),
  checkEbpUsername: jest.fn(),
  fetchTestPaymentAssets: jest.fn(),
  rememberedPaymentOrder: jest.fn(async () => ''),
  rememberPaymentOrder: jest.fn(async () => {}),
  recoverTestPaymentOrder: jest.fn(async () => null),
  createTestPaymentOrder: jest.fn(),
  fetchPaymentOrderStatus: jest.fn(),
  signupEbpMailbox: jest.fn(),
}));

const endpoint = {host: 'mail.pqpost.com', port: 993, secure: true};
const config = (testing: boolean) => ({
  enabled: true as const,
  domain: testing ? TEST_MAIL_DOMAIN : 'pqpost.com',
  imap: endpoint,
  smtp: endpoint,
});
const ORDER = 'b34af21f-ccfd-404b-84cc-865afdad3100';
let tree: renderer.ReactTestRenderer;
const has = (id: string) => tree.root.findAllByProps({testID: id}).length > 0;
const button = (id: string) =>
  tree.root.findAllByType(AppButton).find(node => node.props.testID === id)!;
const field = (id: string) =>
  tree.root.findAllByType(TextField).find(node => node.props.testID === id)!;
async function press(id: string) {
  expect(button(id).props.disabled).not.toBe(true);
  await act(async () => button(id).props.onPress());
}
async function mount(enabled = false, existing = true) {
  jest.mocked(getMailTestMode).mockResolvedValue(enabled);
  await act(async () => {
    tree = renderer.create(<OnboardingWizardScreen />);
  });
  await press(existing ? 'onboarding-use-current' : 'onboarding-start');
}
async function enterUsername(name: string) {
  await act(async () => field('onboarding-username').props.onChangeText(name));
  await act(async () => {
    jest.advanceTimersByTime(350);
  });
}
async function createMailbox() {
  await press('onboarding-address-next');
  await act(async () =>
    field('onboarding-unlock-password').props.onChangeText('secret'),
  );
  await press('onboarding-unlock-next');
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest
    .mocked(fetchEbpSignupConfig)
    .mockImplementation(async (_, testing) => config(!!testing));
  jest.mocked(checkEbpUsername).mockImplementation(async (_, username) => ({
    username,
    available: username.length >= 9,
    purchasable: username.length < 9,
    ...(username.length < 9 ? {usdCents: 100} : {}),
  }));
  jest
    .mocked(fetchTestPaymentAssets)
    .mockResolvedValue([{network: 'ethereum-sepolia', symbol: 'ETH'}]);
  jest
    .mocked(createTestPaymentOrder)
    .mockResolvedValue({
      orderId: ORDER,
      checkoutUrl: `https://test.pqpost.com/checkout.html#${ORDER}`,
    });
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('quoted');
  jest.mocked(signupEbpMailbox).mockResolvedValue({
    email: 'longusername@test.pqpost.com',
    fingerprint: 'fp',
    login: 'login',
    imap: endpoint,
    smtp: endpoint,
    mailPassword: 'mail-secret',
    accountId: 'mail',
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.useRealTimers();
});

it.each([false, true])(
  'skips domain choice with test mail disabled (existing=%s)',
  async existing => {
    await mount(false, existing);
    expect(has('onboarding-username')).toBe(true);
    expect(has('onboarding-domain-test')).toBe(false);
    expect(fetchEbpSignupConfig).toHaveBeenCalledWith(PRODUCTION_KEY_SERVER);
  },
);

it.each([false, true])(
  'offers both domains before the address (existing=%s)',
  async existing => {
    await mount(true, existing);
    expect(has('onboarding-username')).toBe(false);
    expect(has('onboarding-domain-production')).toBe(true);
    expect(has('onboarding-domain-test')).toBe(true);
    await press('onboarding-domain-test');
    expect(field('onboarding-username').props.label).toBe(
      'Username (@test.pqpost.com)',
    );
    expect(fetchEbpSignupConfig).toHaveBeenLastCalledWith(
      PRODUCTION_KEY_SERVER,
      true,
    );
  },
);

it('keeps production signup available when test mail is enabled', async () => {
  await mount(true);
  await press('onboarding-domain-production');
  await enterUsername('longusername');
  await createMailbox();
  expect(checkEbpUsername).toHaveBeenCalledWith(
    PRODUCTION_KEY_SERVER,
    'longusername',
    false,
  );
  expect(signupEbpMailbox).toHaveBeenCalledWith(
    expect.objectContaining({testMode: false, config: config(false)}),
  );
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
});

it('creates long test names without payment assets or checkout', async () => {
  await mount(true);
  await press('onboarding-domain-test');
  await enterUsername('longusername');
  await createMailbox();
  expect(signupEbpMailbox).toHaveBeenCalledWith(
    expect.objectContaining({testMode: true, config: config(true)}),
  );
  expect(fetchTestPaymentAssets).not.toHaveBeenCalled();
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
  expect(fetchPaymentOrderStatus).not.toHaveBeenCalled();
});

it('completes the payment flow for a short test name before creating its mailbox', async () => {
  await mount(true);
  await press('onboarding-domain-test');
  await enterUsername('alice');
  expect(has('onboarding-payment-assets')).toBe(true);
  await createMailbox();
  expect(createTestPaymentOrder).toHaveBeenCalledWith(
    expect.objectContaining({
      username: 'alice',
      domain: TEST_MAIL_DOMAIN,
      asset: {network: 'ethereum-sepolia', symbol: 'ETH'},
    }),
  );
  expect(has('onboarding-checkout')).toBe(true);
  expect(signupEbpMailbox).not.toHaveBeenCalled();
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('confirmed');
  await press('onboarding-retry');
  expect(createTestPaymentOrder).toHaveBeenCalledTimes(1);
  expect(signupEbpMailbox).toHaveBeenCalledWith(
    expect.objectContaining({username: 'alice', testMode: true}),
  );
});

it('clears payment state when changing from a short to a long name', async () => {
  await mount(true);
  await press('onboarding-domain-test');
  await enterUsername('alice');
  expect(has('onboarding-payment-assets')).toBe(true);
  await enterUsername('longusername');
  expect(has('onboarding-payment-assets')).toBe(false);
  await createMailbox();
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
  expect(signupEbpMailbox).toHaveBeenCalled();
});

it('invalidates an earlier availability check when input becomes invalid', async () => {
  await mount();
  await act(async () =>
    field('onboarding-username').props.onChangeText('longusername'),
  );
  await act(async () => field('onboarding-username').props.onChangeText('ab'));
  await act(async () => {
    jest.advanceTimersByTime(350);
  });
  expect(checkEbpUsername).not.toHaveBeenCalled();
  expect(button('onboarding-address-next').props.disabled).toBe(true);
});

it('switches back to production without retaining a paid test name', async () => {
  await mount(true);
  await press('onboarding-domain-test');
  await enterUsername('alice');
  await press('onboarding-address-back');
  await press('onboarding-domain-production');
  expect(field('onboarding-username').props.value).toBe('');
  expect(has('onboarding-payment-assets')).toBe(false);
  await enterUsername('alice');
  expect(button('onboarding-address-next').props.disabled).toBe(true);
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
});

it('keeps domain choice open if the server returns the wrong test domain', async () => {
  await mount(true);
  jest.mocked(fetchEbpSignupConfig).mockResolvedValue(config(false));
  await press('onboarding-domain-test');
  expect(has('onboarding-domain-production')).toBe(true);
  expect(has('onboarding-username')).toBe(false);
});
