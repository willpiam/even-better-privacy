import * as Keychain from 'react-native-keychain';
import {
  enableBiometricUnlock,
  readBiometricPassword,
  getBiometricUnlockStatus,
  disableBiometricUnlock,
} from '../src/services/biometricUnlock';
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only'},
  ACCESS_CONTROL: {BIOMETRY_CURRENT_SET: 'current-biometrics'},
  STORAGE_TYPE: {AES_GCM: 'authenticated-keystore'},
  getSupportedBiometryType: jest.fn(),
  hasGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
beforeEach(() => jest.resetAllMocks());
it('requires biometric protected, device local storage for enrollment', async () => {
  jest
    .mocked(Keychain.setGenericPassword)
    .mockResolvedValue({service: 'test'} as never);
  await enableBiometricUnlock('Personal', 'secret');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'Personal',
    'secret',
    {
      service: 'ebp.identity.biometric.Personal',
      accessible: 'device-only',
      accessControl: 'current-biometrics',
      storage: 'authenticated-keystore',
    },
  );
});
it('does not read secrets when checking availability', async () => {
  jest
    .mocked(Keychain.getSupportedBiometryType)
    .mockResolvedValue('FaceID' as never);
  jest.mocked(Keychain.hasGenericPassword).mockResolvedValue(true);
  await expect(getBiometricUnlockStatus('Personal')).resolves.toEqual({
    available: true,
    enabled: true,
  });
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
});
it('falls back to password when biometrics are unavailable', async () => {
  jest
    .mocked(Keychain.getSupportedBiometryType)
    .mockRejectedValue(new Error('Unavailable'));
  await expect(getBiometricUnlockStatus('Personal')).resolves.toEqual({
    available: false,
    enabled: false,
  });
});
it('does not return another identity credential', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({username: 'Work', password: 'wrong identity'} as never);
  await expect(readBiometricPassword('Personal')).resolves.toBeNull();
});
it.each([
  {code: '-128', message: 'User canceled the operation.'},
  {code: -128, message: 'User canceled the operation.'},
  {code: 'E_CRYPTO_FAILED', message: 'code: 5, msg: Canceled'},
  {code: 'E_CRYPTO_FAILED', message: 'code: 10, msg: User canceled'},
  {code: 'E_CRYPTO_FAILED', message: 'code: 13, msg: Use password'},
])('returns quietly on native cancellation: $code $message', async error => {
  jest.mocked(Keychain.getGenericPassword).mockRejectedValue(error);
  await expect(readBiometricPassword('Personal')).resolves.toBeNull();
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});
it.each([
  {code: '-25293', message: 'Authentication failed'},
  {code: 'E_CRYPTO_FAILED', message: 'code: 7, msg: Lockout'},
  {code: 'E_CRYPTO_FAILED', message: 'code: 9, msg: Permanent lockout'},
  {code: 'E_CRYPTO_FAILED', message: 'Could not decrypt data'},
])('preserves real biometric errors: $message', async error => {
  jest.mocked(Keychain.getGenericPassword).mockRejectedValue(error);
  await expect(readBiometricPassword('Personal')).rejects.toBe(error);
});
it('deletes credentials only for the requested identity', async () => {
  await disableBiometricUnlock(' Personal ');
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
    service: 'ebp.identity.biometric.Personal',
  });
});
