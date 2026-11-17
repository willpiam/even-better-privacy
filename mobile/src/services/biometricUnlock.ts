const serviceFor = (name: string) => `ebp.identity.biometric.${name.trim()}`;

function isBiometricCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const {code, message} = error as {code?: string | number; message?: string};
  // iOS errSecUserCanceled. Android Keychain 10 wraps BiometricPrompt's
  // canceled (5), user canceled (10), and negative button (13) codes in a message.
  return (
    String(code) === '-128' ||
    (code === 'E_CRYPTO_FAILED' &&
      typeof message === 'string' &&
      /^code: (5|10|13), msg:/.test(message))
  );
}

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
  try {
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
  } catch (error) {
    if (isBiometricCancellation(error)) return null;
    throw error;
  }
}

export async function disableBiometricUnlock(name: string) {
  const Keychain = await import('react-native-keychain');
  await Keychain.resetGenericPassword({service: serviceFor(name)});
}
