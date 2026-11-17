const serviceFor = (name: string) => `ebp.identity.biometric.${name.trim()}`;

/** No secret is read while deciding which controls to show. */
export async function getBiometricUnlockStatus(name: string) {
  try {
    const Keychain = await import('react-native-keychain');
    const available = Boolean(await Keychain.getSupportedBiometryType());
    const enabled =
      available &&
      Boolean(
        await Keychain.hasGenericPassword({
          service: serviceFor(name),
        }),
      );
    return {available, enabled};
  } catch {
    return {available: false, enabled: false};
  }
}

/** Call only after the password has successfully unlocked the identity. */
export async function enableBiometricUnlock(name: string, password: string) {
  const Keychain = await import('react-native-keychain');
  const saved = await Keychain.setGenericPassword(name.trim(), password, {
    service: serviceFor(name),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    storage: Keychain.STORAGE_TYPE.AES_GCM,
  });
  if (!saved) throw new Error('Could not enable biometric unlock');
}

export async function readBiometricPassword(
  name: string,
): Promise<string | null> {
  const Keychain = await import('react-native-keychain');
  const credentials = await Keychain.getGenericPassword({
    service: serviceFor(name),
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    authenticationPrompt: {
      title: 'Unlock identity',
      subtitle: name.trim(),
      cancel: 'Use password',
    },
  });
  return credentials && credentials.username === name.trim()
    ? credentials.password
    : null;
}

export async function disableBiometricUnlock(name: string) {
  const Keychain = await import('react-native-keychain');
  await Keychain.resetGenericPassword({service: serviceFor(name)});
}
