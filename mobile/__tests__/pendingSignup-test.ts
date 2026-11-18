import AsyncStorage from '@react-native-async-storage/async-storage';
import {pendingSignups, savePendingSignup, removePendingSignup, completeMailboxSignup, type PendingSignup} from '../src/services/mail/pendingSignup';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const signup: PendingSignup = {
  server: 'https://keys.example.test', domain: 'test.pqpost.com',
  identityName: 'Personal', username: 'alice', orderId: 'original-order', testMode: true,
};

beforeEach(async () => AsyncStorage.clear());

it('persists resumable setup while excluding secrets and isolating server/domain/mode', async () => {
  await savePendingSignup({...signup, password: 'secret', mnemonic: 'recovery phrase'} as PendingSignup);
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
  expect(await pendingSignups('https://other.test', signup.domain, true)).toEqual([]);
  expect(await pendingSignups(signup.server, 'pqpost.com', true)).toEqual([]);
  expect(await pendingSignups(signup.server, signup.domain, false)).toEqual([]);
  expect(await pendingSignups(signup.server, undefined, true)).toEqual([signup]);
  const values = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  expect(JSON.stringify(values)).not.toMatch(/secret|recovery phrase/);
});

it('recovers old order-only records and skips damaged records', async () => {
  await AsyncStorage.setItem(`ebp.mail.order:${signup.server}:Personal:alice`, signup.orderId);
  await AsyncStorage.setItem('ebp.mail.signup:broken', '{');
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
  await savePendingSignup(signup);
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([signup]);
});

it('clears only the completed setup and its legacy order', async () => {
  const other = {...signup, username: 'bob', orderId: 'another-order'};
  await savePendingSignup(signup);
  await savePendingSignup(other);
  await AsyncStorage.setItem(`ebp.mail.order:${signup.server}:Personal:alice`, signup.orderId);
  await removePendingSignup(signup);
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([other]);
});

it('keeps completed setup hidden even if cleanup fails and legacy records remain', async () => {
  await savePendingSignup(signup);
  await AsyncStorage.setItem(`ebp.mail.order:${signup.server}:Personal:alice`, signup.orderId);
  jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error('Delete failed'));
  await completeMailboxSignup(signup.server, signup.identityName, 'alice@test.pqpost.com');
  expect(await pendingSignups(signup.server, signup.domain, true)).toEqual([]);
  expect(await pendingSignups(signup.server, undefined, true)).toEqual([]);
});
