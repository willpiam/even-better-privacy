import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import React, {useCallback, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  getMailSecretsStatus,
  readMailStore,
  selectMailAccount,
} from '../../services/mail/accountStore';
import {getServerUrl} from '../../services/settings';
import {fetchEbpSignupConfig, resetEbpMailbox} from '../../services/mail/ebpSignup';
import {appendActivityLog} from '../../services/activityLog';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import ListRow from '../../components/ListRow';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {radius, spacing, typography} from '../../theme/tokens';
import {mailColors as colors} from './MailAppearance';

type Props = NativeStackScreenProps<MailStackParamList, 'MailAccounts'>;

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [identityName, setIdentityName] = useState('');
  const [accounts, setAccounts] = useState<
    Array<{id: string; name: string; fromEmail: string}>
  >([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('');
  const [mailDomain, setMailDomain] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const promptedThisFocus = useRef(false);

  const refresh = useCallback(async () => {
    const name = await getCurrentIdentityRequired();
    setIdentityName(name);
    const store = await readMailStore(name);
    setSelectedAccountId(store.selectedAccountId);
    setAccounts(
      store.accounts.map(a => ({
        id: a.id,
        name: a.name,
        fromEmail: a.config.fromEmail || a.config.username,
      })),
    );
    const secretStatus = await getMailSecretsStatus(name);
    setSecretsLocked(secretStatus.locked && !secretStatus.inMemory);
    try {
      const cfg = await fetchEbpSignupConfig(await getServerUrl());
      setMailDomain(cfg.enabled ? cfg.domain : '');
    } catch {
      setMailDomain('');
    }
    return secretStatus.locked && !secretStatus.inMemory;
  }, []);

  const unlockMailWithIdentity = useCallback(
    async () => {
      setUnlocking(true);
      try {
        setStatus('');
        const name = identityName || (await getCurrentIdentityRequired());
        if (!(await ensureUnlocked(name))) return;
        await appendActivityLog('Mail secrets unlocked', 'success');
        setStatus('Mail secrets unlocked');
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setUnlocking(false);
      }
    },
    [identityName, refresh, ensureUnlocked],
  );

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
      void (async () => {
        const locked = await refreshRef.current();
        if (cancelled || !locked || promptedThisFocus.current) {
          return;
        }
        promptedThisFocus.current = true;
        await requestIdentityUnlockRef.current();
      })();
      return () => {
        cancelled = true;
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
      const name = identityName || (await getCurrentIdentityRequired());
      const res = await resetEbpMailbox({
        identityName: name,
        password,
        server,
        config,
      });
      await appendActivityLog(`EBP mailbox access restored: ${res.email}`, 'success');
      setStatus(`Mailbox access restored for ${res.email}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  return (
    <Screen scroll style={styles.screen}>
      {secretPrompt}
      {unlockPrompt}
      <BusyOverlay
        visible={unlocking || busyMessage !== null}
        message={busyMessage ?? 'Unlocking mail secrets…'}
      />
      <Text style={styles.eyebrow}>CURRENT IDENTITY · {identityName || '…'}</Text>
      <Text style={styles.header}>Your mail accounts</Text>
      {accounts.length > 0 ? (
        <AppButton title="Open inbox" style={styles.primary}
          onPress={() => navigation.navigate('MailInbox')} />
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

      {accounts.length > 0 ? (
        <View style={styles.accountList}>
          {accounts.map(a => {
            const selected = a.id === selectedAccountId;
            return (
              <Card key={a.id}>
                <ListRow
                  title={a.name}
                  subtitle={a.fromEmail}
                  badge={selected ? 'Selected' : undefined}
                  avatarText={a.name}
                  onPress={() =>
                    navigation.navigate('MailAccountSetup', {accountId: a.id})
                  }
                />
                {!selected ? (
                  <View style={styles.selectWrap}>
                    <AppButton
                      title="Select"
                      variant="secondary"
                      onPress={() => {
                        void (async () => {
                          await selectMailAccount(identityName, a.id);
                          await refresh();
                        })();
                      }}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>No mail accounts yet.</Text>
      )}

      <AppButton
        title="Create an EBP email address"
        testID="mail-onboarding"
        onPress={() => navigation.navigate('OnboardingWizard')}
      />
      {mailDomain ? (
        <AppButton
          title="Restore mailbox access"
          testID="mail-restore-access"
          variant="secondary"
          onPress={() => void onRestoreMailbox()}
        />
      ) : null}
      <AppButton
        title="Add account"
        variant="secondary"
        onPress={() => navigation.navigate('MailAccountSetup', {})}
      />
      <AppButton
        title="Mail help"
        variant="secondary"
        onPress={() => navigation.navigate('MailHelp')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: colors.page},
  primary: {backgroundColor: colors.accent},
  eyebrow: {fontSize: 10, letterSpacing: 1.4, color: colors.muted, marginTop: 8},
  header: {
    fontWeight: '700',
    fontSize: 26,
    color: colors.text,
  },
  empty: {
    color: colors.muted,
    fontSize: typography.body,
    paddingVertical: spacing.md,
  },
  accountList: {gap: 10},
  selectWrap: {
    padding: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
