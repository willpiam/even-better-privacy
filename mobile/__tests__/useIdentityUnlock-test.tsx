import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useIdentityUnlock} from '../src/hooks/useIdentityUnlock';
import {unlockIdentity} from '../src/services/storage';
import {
  enableBiometricUnlock,
  getBiometricUnlockStatus,
  readBiometricPassword,
  disableBiometricUnlock,
} from '../src/services/biometricUnlock';
const mockPrompt = jest.fn();
jest.mock('../src/hooks/useSecretPrompt', () => ({
  useSecretPrompt: () => ({promptSecret: mockPrompt, secretPrompt: null}),
}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentityRequired: async () => 'Personal',
  unlockIdentity: jest.fn(),
}));
jest.mock('../src/services/unlockSession', () => ({
  installIdentityUnlockWatcher: jest.fn(),
  isUnlocked: () => false,
}));
jest.mock('../src/services/mail/accountStore', () => ({
  getMailSecretsStatus: async () => ({locked: false}),
  getMailPinInMemory: () => 'pin',
}));
jest.mock('../src/services/biometricUnlock', () => ({
  enableBiometricUnlock: jest.fn(),
  getBiometricUnlockStatus: jest.fn(),
  readBiometricPassword: jest.fn(),
  disableBiometricUnlock: jest.fn(async () => {}),
}));
let unlock: ReturnType<typeof useIdentityUnlock>;
let tree: renderer.ReactTestRenderer;
function Harness() {
  unlock = useIdentityUnlock();
  return null;
}
beforeEach(async () => {
  jest.resetAllMocks();
  jest.mocked(unlockIdentity).mockResolvedValue('Personal');
  jest.mocked(disableBiometricUnlock).mockResolvedValue(undefined);
  jest
    .mocked(getBiometricUnlockStatus)
    .mockResolvedValue({available: true, enabled: false});
  await act(async () => {
    tree = renderer.create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
it('saves credentials only after successful password verification and opt-in', async () => {
  mockPrompt.mockImplementation(async options => {
    options.onBiometricEnrollmentChange(true);
    return 'password';
  });
  await expect(unlock.ensureUnlocked()).resolves.toBe('Personal');
  expect(enableBiometricUnlock).toHaveBeenCalledWith('Personal', 'password');
  expect(jest.mocked(unlockIdentity).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(enableBiometricUnlock).mock.invocationCallOrder[0],
  );
});
it('does not enroll with an invalid password', async () => {
  mockPrompt.mockImplementation(async options => {
    options.onBiometricEnrollmentChange(true);
    return 'wrong';
  });
  jest.mocked(unlockIdentity).mockRejectedValue(new Error('Wrong password'));
  await expect(unlock.ensureUnlocked()).rejects.toThrow('Wrong password');
  expect(enableBiometricUnlock).not.toHaveBeenCalled();
});
it('unlocks through biometrics using the identity and mail password path once', async () => {
  jest
    .mocked(getBiometricUnlockStatus)
    .mockResolvedValue({available: true, enabled: true});
  jest.mocked(readBiometricPassword).mockResolvedValue('saved');
  mockPrompt.mockImplementation(async options => options.biometricUnlock());
  await expect(unlock.ensureUnlocked()).resolves.toBe('Personal');
  expect(unlockIdentity).toHaveBeenCalledTimes(1);
  expect(unlockIdentity).toHaveBeenCalledWith('Personal', 'saved');
});
it.each(['Cancelled', 'Wrong password'])(
  'permits password fallback after %s',
  async reason => {
    jest
      .mocked(getBiometricUnlockStatus)
      .mockResolvedValue({available: true, enabled: true});
    if (reason === 'Cancelled')
      jest.mocked(readBiometricPassword).mockRejectedValue(new Error(reason));
    else {
      jest.mocked(readBiometricPassword).mockResolvedValue('old');
      jest.mocked(unlockIdentity).mockRejectedValueOnce(new Error(reason));
    }
    mockPrompt.mockImplementation(async options => {
      await expect(options.biometricUnlock()).rejects.toThrow(reason);
      return 'manual';
    });
    await expect(unlock.ensureUnlocked()).resolves.toBe('Personal');
    expect(unlockIdentity).toHaveBeenCalledWith('Personal', 'manual');
    if (reason === 'Wrong password')
      expect(disableBiometricUnlock).toHaveBeenCalledWith('Personal');
  },
);
it('does not unlock or save after cancellation', async () => {
  mockPrompt.mockResolvedValue(null);
  await expect(unlock.ensureUnlocked()).resolves.toBeNull();
  expect(unlockIdentity).not.toHaveBeenCalled();
  expect(enableBiometricUnlock).not.toHaveBeenCalled();
});
