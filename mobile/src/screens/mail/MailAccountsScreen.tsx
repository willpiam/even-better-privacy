import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  selectMailAccount,
} from '../../services/mail/accountStore';
import {getServerUrl} from '../../services/settings';
import {
  fetchEbpSignupConfig,
  lookupVerifiedManagedEmail,
  resetEbpMailbox,
} from '../../services/mail/ebpSignup';
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
import PlaceHeader from '../../components/PlaceHeader';
import AppIcon from '../../components/AppIcon';

type Props = NativeStackScreenProps<MailStackParamList, 'MailAccounts'>;

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [identityName, setIdentityName] = useState('');
  const [accounts, setAccounts] = useState<
    Array<{id: string; name: string; fromEmail: string}>
  >([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('');
  const [needsRestore, setNeedsRestore] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasAccounts = accounts.length > 0;
  const promptedThisFocus = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setMenuOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [menuOpen]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasAccounts
        ? () => (
            <Pressable
              testID="mail-add"
              accessibilityRole="button"
              accessibilityLabel="Add mail account"
              accessibilityState={{expanded: menuOpen}}
              style={styles.headerAction}
              onPress={() => setMenuOpen(open => !open)}>
              <AppIcon name="plus" color={colors.accent} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, hasAccounts, menuOpen]);

  const refresh = useCallback(async (onLocked?: () => void) => {
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
    const locked = secretStatus.locked && !secretStatus.inMemory;
    setSecretsLocked(locked);
    // Unlock is a local decision; server discovery must not delay the prompt.
    if (locked) onLocked?.();
    try {
      setNeedsRestore(false);
      const server = await getServerUrl();
      const cfg = await fetchEbpSignupConfig(server);
      const identity = await readCurrentIdentityPublic();
      if (cfg.enabled && identity?.name === name) {
        const email = await lookupVerifiedManagedEmail(
          server,
          identity.publicData.fingerprint,
          cfg.domain,
        );
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
      setNeedsRestore(false);
    }
    return secretStatus.locked && !secretStatus.inMemory;
  }, []);

  const unlockMailWithIdentity = useCallback(async () => {
    setUnlocking(true);
    try {
      setStatus('');
      const name = identityName || (await getCurrentIdentityRequired());
      if (!(await ensureUnlocked(name))) return;
      setStatus('Mail secrets unlocked');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUnlocking(false);
    }
  }, [identityName, refresh, ensureUnlocked]);

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
        setMenuOpen(false);
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
      setStatus(`Mailbox access restored for ${res.email}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
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
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}>
        <PlaceHeader
          place="mail"
          title="Your mail"
          subtitle="A quiet place for your letters. All your accounts, together."
          eyebrow={`CURRENT IDENTITY · ${identityName || '…'}`}
        />
        {hasAccounts ? (
          <AppButton
            title="Open inbox"
            style={styles.primary}
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

        {hasAccounts ? (
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

        {!hasAccounts ? (
          <AppButton
            title="Create an EBP email address"
            testID="mail-onboarding"
            onPress={() => navigation.navigate('OnboardingWizard')}
          />
        ) : null}
        {needsRestore ? (
          <AppButton
            title="Restore mailbox access"
            testID="mail-restore-access"
            variant="secondary"
            onPress={() => void onRestoreMailbox()}
          />
        ) : null}
        {!hasAccounts ? (
          <AppButton
            title="Add account"
            testID="mail-add-account"
            variant="secondary"
            onPress={() => navigation.navigate('MailAccountSetup', {})}
          />
        ) : null}
      </ScrollView>
      {hasAccounts && menuOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            testID="mail-menu-dismiss"
            accessibilityRole="button"
            accessibilityLabel="Dismiss mail account menu"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <Card style={styles.menu}>
            <Pressable
              testID="mail-add-account"
              accessibilityRole="button"
              accessibilityLabel="Add account"
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('MailAccountSetup', {});
              }}>
              <Text style={styles.menuText}>Add account</Text>
            </Pressable>
            <Pressable
              testID="mail-onboarding"
              accessibilityRole="button"
              accessibilityLabel="Create an EBP email address"
              style={[styles.menuItem, styles.menuDivider]}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('OnboardingWizard');
              }}>
              <Text style={styles.menuText}>Create an EBP email address</Text>
            </Pressable>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: colors.page},
  content: {padding: 0, paddingBottom: 0},
  body: {flex: 1},
  bodyContent: {
    padding: spacing.lg + 4,
    paddingBottom: 32,
    gap: 14,
  },
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    top: 0,
    right: 12,
    width: 260,
    maxWidth: '100%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  menuItem: {minHeight: 48, justifyContent: 'center', padding: 14},
  menuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuText: {fontSize: typography.body, color: colors.accent},
  primary: {backgroundColor: colors.accent},
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
