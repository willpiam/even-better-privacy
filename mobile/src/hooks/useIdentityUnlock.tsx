import {useCallback, useEffect} from 'react';
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
        const password = await promptSecret({
          title: 'Unlock identity',
          placeholder: 'Identity password',
          submitLabel: 'Unlock',
        });
        if (password === null) return null;
        await unlockIdentity(identityName, password);
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
