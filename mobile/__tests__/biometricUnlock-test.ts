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
it('deletes credentials only for the requested identity', async () => {
  await disableBiometricUnlock(' Personal ');
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
    service: 'ebp.identity.biometric.Personal',
  });
});
