import {useCallback, useEffect} from 'react';
import {useSecretPrompt} from './useSecretPrompt';
import {unlockMailSecretsWithPin} from '../services/mail/accountStore';
import {getCurrentIdentityRequired, unlockIdentity} from '../services/storage';
import {installIdentityUnlockWatcher, isUnlocked} from '../services/unlockSession';

/**
 * Unlock an identity once per idle session.
 * Returns the identity name, or null if the user cancels.
 * A wrong password throws. Mail secrets are tried with the same password and
 * failures are ignored so a different email PIN can still be entered later.
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
      if (isUnlocked(identityName)) {
        return identityName;
      }
      const password = await promptSecret({
        title: 'Unlock identity',
        placeholder: 'Identity password',
        submitLabel: 'Unlock',
      });
      if (password === null) {
        return null;
      }
      const unlocked = await unlockIdentity(identityName, password);
      try {
        await unlockMailSecretsWithPin(unlocked, password);
      } catch {
        // Managed mailboxes use the identity password as the PIN.
        // A different manual PIN still unlocks from the mail screens.
      }
      return unlocked;
    },
    [promptSecret],
  );

  return {ensureUnlocked, unlockPrompt: secretPrompt};
}
