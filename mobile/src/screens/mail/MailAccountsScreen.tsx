import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import React, {useCallback, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {
  getCurrentIdentityRequired,
  readCurrentIdentityPublic,
} from '../../services/storage';
import {
  getMailSecretsStatus,
  readMailStore,
  getMailSecretsInMemory,
  resolveSelectedAccountId,
} from '../../services/mail/accountStore';
import {getServerUrl} from '../../services/settings';
import {
  fetchEbpSignupConfig,
  lookupVerifiedManagedEmail,
  resetEbpMailbox,
} from '../../services/mail/ebpSignup';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {layout, radius, spacing, typography} from '../../theme/tokens';
import {mailColors as colors} from './MailAppearance';
import PlaceHeader from '../../components/PlaceHeader';

type Props = NativeStackScreenProps<MailStackParamList, 'MailAccounts'>;

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [mailbox, setMailbox] = useState<{
    identityName: string;
    email: string | null;
  }>();
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('');
  const [needsRestore, setNeedsRestore] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const promptedThisFocus = useRef(false);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async (onLocked?: () => void) => {
    const version = ++refreshVersion.current;
    const name = await getCurrentIdentityRequired();
    const store = await readMailStore(name);
    if (version !== refreshVersion.current) return;
    const accountId = resolveSelectedAccountId(store);
    const account = store.accounts.find(item => item.id === accountId);
    setMailbox({
      identityName: name,
      email: account
        ? account.config.fromEmail || account.config.username
        : null,
    });
    const secretStatus = await getMailSecretsStatus(name);
    if (version !== refreshVersion.current) return;
    const locked = secretStatus.locked && !secretStatus.inMemory;
    setSecretsLocked(locked);
    // Unlock is a local decision; server discovery must not delay the prompt.
    if (locked) onLocked?.();
    setNeedsRestore(false);
    try {
      const server = await getServerUrl();
      const cfg = await fetchEbpSignupConfig(server);
      const identity = await readCurrentIdentityPublic();
      if (cfg.enabled && identity?.name === name) {
        const email = await lookupVerifiedManagedEmail(
          server,
          identity.publicData.fingerprint,
          cfg.domain,
        );
        if (version !== refreshVersion.current) return;
        const local = store.accounts.find(
          a =>
            (a.config.fromEmail || a.config.username).toLowerCase() ===
            email?.toLowerCase(),
        );
        // Locked credentials need unlocking, not a mailbox password reset.
        const secrets = local ? getMailSecretsInMemory(name, local.id) : null;
        setNeedsRestore(
          Boolean(
            email &&
              (!local || (!secretStatus.locked && !secrets?.imapPassword)),
          ),
        );
      }
    } catch {
      // Mail remains available if managed mailbox discovery fails.
    }
  }, []);

  const unlockMailWithIdentity = useCallback(async () => {
    setUnlocking(true);
    try {
      setStatus('');
      const name = await getCurrentIdentityRequired();
      if (!(await ensureUnlocked(name))) return;
      setStatus('Mail secrets unlocked');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUnlocking(false);
    }
  }, [refresh, ensureUnlocked]);

  const requestIdentityUnlock = useCallback(async () => {
    await unlockMailWithIdentity();
  }, [unlockMailWithIdentity]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const requestIdentityUnlockRef = useRef(requestIdentityUnlock);
  requestIdentityUnlockRef.current = requestIdentityUnlock;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      promptedThisFocus.current = false;
      setMailbox(undefined);
      setSecretsLocked(false);
      setNeedsRestore(false);
      setStatus('');
      void (async () => {
        try {
          await refreshRef.current(() => {
            if (cancelled || promptedThisFocus.current) return;
            promptedThisFocus.current = true;
            void requestIdentityUnlockRef.current();
          });
        } catch (error) {
          if (!cancelled) {
            setStatus(error instanceof Error ? error.message : String(error));
          }
        }
      })();
      return () => {
        cancelled = true;
        refreshVersion.current += 1;
      };
    }, []),
  );

  const onRestoreMailbox = async () => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password',
      submitLabel: 'Restore',
    });
    if (password === null) {
      return;
    }
    if (!password.trim()) {
      setStatus('Identity password is required');
      return;
    }
    setBusyMessage('Restoring mailbox access…');
    try {
      setStatus('');
      const server = await getServerUrl();
      const config = await fetchEbpSignupConfig(server);
      const name = await getCurrentIdentityRequired();
      const res = await resetEbpMailbox({
        identityName: name,
        password,
        server,
        config,
      });
      setStatus(`Mailbox access restored for ${res.email}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      {secretPrompt}
      {unlockPrompt}
      <BusyOverlay
        visible={unlocking || busyMessage !== null}
        message={busyMessage ?? 'Unlocking mail secrets…'}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <PlaceHeader
          place="mail"
          title="Your mail"
          subtitle={mailbox?.email ?? ''}
          eyebrow={`CURRENT IDENTITY · ${mailbox?.identityName ?? '…'}`}
        />
        {mailbox?.email != null ? (
          <AppButton
            title="Open inbox"
            onPress={() => navigation.navigate('MailInbox')}
          />
        ) : null}
        <StatusBanner message={status} kind={statusKind(status)} />

        {secretsLocked ? (
          <View style={styles.lockedBanner}>
            <Text style={styles.lockedText}>
              Mail secrets are locked for this session.
            </Text>
            <AppButton
              title="Unlock"
              variant="secondary"
              disabled={unlocking}
              onPress={() => void requestIdentityUnlock()}
            />
          </View>
        ) : null}

        {mailbox?.email === null ? (
          <>
            <Text style={styles.empty}>No mail accounts yet.</Text>
            <AppButton
              title="Create an EBP email address"
              testID="mail-onboarding"
              onPress={() => navigation.navigate('OnboardingWizard')}
            />
          </>
        ) : null}
        {needsRestore ? (
          <AppButton
            title="Restore mailbox access"
            testID="mail-restore-access"
            variant="secondary"
            onPress={() => void onRestoreMailbox()}
          />
        ) : null}
        {mailbox?.email === null ? (
          <AppButton
            title="Add account"
            testID="mail-add-account"
            variant="secondary"
            onPress={() => navigation.navigate('MailAccountSetup', {})}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {padding: 0, paddingBottom: 0},
  body: {flex: 1},
  bodyContent: {
    padding: layout.gutter,
    paddingBottom: 32,
    gap: 14,
  },
  empty: {
    color: colors.muted,
    fontSize: typography.body,
    paddingVertical: spacing.md,
  },
  lockedBanner: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: '#fffbeb',
    gap: 10,
  },
  lockedText: {
    color: colors.text,
    fontSize: typography.caption,
  },
});
