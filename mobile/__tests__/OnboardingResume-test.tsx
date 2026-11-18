import React from 'react';
import renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingWizardScreen from '../src/screens/OnboardingWizardScreen';
import AppButton from '../src/components/AppButton';
import TextField from '../src/components/TextField';
import {pendingSignups, savePendingSignup, type PendingSignup} from '../src/services/mail/pendingSignup';
import {createTestPaymentOrder, fetchPaymentOrderStatus, recoverTestPaymentOrder, signupEbpMailbox} from '../src/services/mail/ebpSignup';
import {publishIdentity} from '../src/services/publish';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({goBack: jest.fn()})}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View}));
jest.mock('@react-native-clipboard/clipboard', () => ({setString: jest.fn()}));
jest.mock('react-native-share', () => ({open: jest.fn()}));
jest.mock('../src/components/FoxArt', () => ({__esModule: true, default: () => null, FoxMotion: () => null}));
jest.mock('../src/hooks/useSecretPrompt', () => ({useSecretPrompt: () => ({secretPrompt: null})}));
jest.mock('../src/ebpCore', () => ({randomHex: () => 'abcd', validatePassword: () => ({ok: true})}));
jest.mock('../src/services/hd', () => ({createHdIdentity: jest.fn(), createHdMnemonic: jest.fn()}));
jest.mock('../src/services/publish', () => ({publishIdentity: jest.fn(async () => {})}));
jest.mock('../src/services/storage', () => ({getCurrentIdentity: async () => 'Personal', listIdentities: async () => [], setCurrentIdentity: jest.fn()}));
jest.mock('../src/services/settings', () => ({getServerUrl: async () => 'https://keys.example.test', getMailTestMode: async () => true}));
jest.mock('../src/services/mail/ebpSignup', () => ({
  fetchEbpSignupConfig: async (_: string, testing = false) => ({enabled: true, domain: testing ? 'test.pqpost.com' : 'pqpost.com'}),
  rememberedPaymentOrder: async () => '',
  rememberPaymentOrder: jest.fn(),
  fetchPaymentOrderStatus: jest.fn(),
  recoverTestPaymentOrder: jest.fn(),
  createTestPaymentOrder: jest.fn(),
  signupEbpMailbox: jest.fn(),
  EbpMailApiError: class extends Error {},
}));

const signup: PendingSignup = {
  server: 'https://keys.example.test', domain: 'test.pqpost.com',
  identityName: 'Personal', username: 'alice', orderId: 'original-order', testMode: true,
};
let tree: renderer.ReactTestRenderer;
const button = (id: string) => tree.root.findAllByType(AppButton).find(node => node.props.testID === id)!;
async function mount() {
  await act(async () => {tree = renderer.create(<OnboardingWizardScreen />);});
}
async function resume() {
  await act(async () => button('onboarding-resume-alice').props.onPress());
  await act(async () => {
    tree.root.findAllByType(TextField).find(node => node.props.testID === 'onboarding-unlock-password')!
      .props.onChangeText('identity-secret');
  });
  await act(async () => button('onboarding-unlock-next').props.onPress());
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await savePendingSignup(signup);
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('pending');
  jest.mocked(recoverTestPaymentOrder).mockResolvedValue('original-order');
  jest.mocked(signupEbpMailbox).mockResolvedValue({email: 'alice@test.pqpost.com', fingerprint: 'fp',
    imap: {host: 'mail.test', port: 993, secure: true}, smtp: {host: 'mail.test', port: 465, secure: true},
    login: 'alice@test.pqpost.com', mailPassword: 'mail-secret', accountId: 'account'});
});
afterEach(async () => {if (tree) await act(async () => tree.unmount());});

it('resumes after an unmount, checks the same order, then completes after payment elsewhere', async () => {
  await mount();
  await resume();
  expect(fetchPaymentOrderStatus).toHaveBeenCalledWith(signup.server, signup.orderId);
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
  expect(signupEbpMailbox).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('confirmed');
  await mount();
  await resume();
  expect(signupEbpMailbox).toHaveBeenCalledWith(expect.objectContaining({identityName: 'Personal', username: 'alice'}));
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([]);
});

it('retains paid setup after a temporary mailbox error and completes on retry', async () => {
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('confirmed');
  jest.mocked(signupEbpMailbox).mockRejectedValueOnce(new Error('Temporary mailbox failure'));
  await mount();
  await resume();
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
  await act(async () => button('onboarding-retry').props.onPress());
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([]);
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
});

it('recovers the order when the app closed before receiving the order response', async () => {
  await savePendingSignup({...signup, orderId: ''});
  await mount();
  await resume();
  expect(recoverTestPaymentOrder).toHaveBeenCalledWith(expect.objectContaining({identityName: 'Personal', username: 'alice'}));
  expect(fetchPaymentOrderStatus).toHaveBeenCalledWith(signup.server, signup.orderId);
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
});

it('retains expired orders and retries without creating a replacement payment', async () => {
  jest.mocked(fetchPaymentOrderStatus).mockResolvedValue('expired');
  await mount();
  await resume();
  expect(button('onboarding-retry').props.title).toBe('Check payment');
  await act(async () => button('onboarding-retry').props.onPress());
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
  expect(createTestPaymentOrder).not.toHaveBeenCalled();
});

it('lets the user correct a wrong identity password when resuming', async () => {
  jest.mocked(publishIdentity).mockRejectedValueOnce(new Error('Wrong password'));
  await mount();
  await resume();
  const passwordField = tree.root.findAllByType(TextField).find(node => node.props.testID === 'onboarding-unlock-password')!;
  expect(passwordField.props.value).toBe('');
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
  await act(async () => passwordField.props.onChangeText('correct-password'));
  await act(async () => button('onboarding-unlock-next').props.onPress());
  expect(fetchPaymentOrderStatus).toHaveBeenCalledWith(signup.server, signup.orderId);
});
