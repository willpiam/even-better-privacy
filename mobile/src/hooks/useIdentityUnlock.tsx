import {useCallback, useEffect} from 'react';
import {Alert} from 'react-native';
import {
  enableBiometricUnlock,
  getBiometricUnlockStatus,
  readBiometricPassword,
  disableBiometricUnlock,
} from '../services/biometricUnlock';
import {useSecretPrompt} from './useSecretPrompt';
import {
  getMailSecretsStatus,
  getMailPinInMemory,
} from '../services/mail/accountStore';
import {getCurrentIdentityRequired, unlockIdentity} from '../services/storage';
import {
  installIdentityUnlockWatcher,
  isUnlocked,
} from '../services/unlockSession';

/**
 * Unlock an identity once per idle session.
 * Returns the identity name, or null if the user cancels.
 * A wrong password throws. Mail credentials use the same identity password.
 */
export function useIdentityUnlock(): {
  ensureUnlocked: (name?: string) => Promise<string | null>;
  unlockPrompt: JSX.Element;
} {
  const {promptSecret, secretPrompt} = useSecretPrompt();

  useEffect(() => {
    installIdentityUnlockWatcher();
  }, []);

  const ensureUnlocked = useCallback(
    async (name?: string): Promise<string | null> => {
      const identityName = name?.trim() || (await getCurrentIdentityRequired());
      const mailStatus = await getMailSecretsStatus(identityName);
      if (
        !isUnlocked(identityName) ||
        (!mailStatus.locked && !getMailPinInMemory(identityName))
      ) {
        const biometrics = await getBiometricUnlockStatus(identityName);
        let enrollBiometrics = false;
        let unlockedWithBiometrics = false;
        const password = await promptSecret({
          title: 'Unlock identity',
          placeholder: 'Identity password',
          submitLabel: 'Unlock',
          biometricUnlock: biometrics.enabled
            ? async () => {
                const secret = await readBiometricPassword(identityName);
                if (secret === null) return null;
                try {
                  await unlockIdentity(identityName, secret);
                } catch (error) {
                  if (
                    error instanceof Error &&
                    error.message === 'Wrong password'
                  ) {
                    await disableBiometricUnlock(identityName).catch(() => {});
                  }
                  throw error;
                }
                unlockedWithBiometrics = true;
                return secret;
              }
            : undefined,
          onBiometricEnrollmentChange: biometrics.available
            ? enabled => {
                enrollBiometrics = enabled;
              }
            : undefined,
        });
        if (password === null) return null;
        if (!unlockedWithBiometrics)
          await unlockIdentity(identityName, password);
        if (enrollBiometrics) {
          try {
            await enableBiometricUnlock(identityName, password);
          } catch {
            Alert.alert(
              'Biometrics unavailable',
              'Identity unlocked. Biometric setup failed; you can try again next time.',
            );
          }
        }
      }
      if ((await getMailSecretsStatus(identityName)).locked) {
        throw new Error(
          'Stored mail credentials could not be unlocked with the identity password',
        );
      }
      return identityName;
    },
    [promptSecret],
  );

  return {ensureUnlocked, unlockPrompt: secretPrompt};
}
