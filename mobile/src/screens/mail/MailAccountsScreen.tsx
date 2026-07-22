import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  getMailSecretsStatus,
  readMailStore,
  selectMailAccount,
  setMailSecretsInMemory,
  unlockMailSecretsWithPin,
  upsertMailAccount,
} from '../../services/mail/accountStore';
import {
  completeMailOAuthFromUrl,
  fetchMailOAuthConfig,
  getOAuthProviderConfig,
  openMailOAuthBrowser,
  resolveOAuthClientId,
  startMailOAuth,
  subscribeMailOAuthCallbacks,
  type MailOauthServerConfig,
} from '../../services/mail/oauth';
import {DEFAULT_MAIL_ACCOUNT, type MailOauthProvider} from '../../services/mail/types';
import {
  getMailOauthGmailClientIdOverride,
  getMailOauthOutlookClientIdOverride,
  getServerUrl,
} from '../../services/settings';
import {appendActivityLog} from '../../services/activityLog';
import Screen from '../../components/Screen';
import AddAccountModal from '../../components/AddAccountModal';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import ListRow from '../../components/ListRow';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {colors, radius, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailAccounts'>;

const EMPTY_OAUTH_CONFIG: MailOauthServerConfig = {
  gmail: {clientId: '', configured: false},
  outlook: {clientId: '', configured: false},
};

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [identityName, setIdentityName] = useState('');
  const [accounts, setAccounts] = useState<
    Array<{id: string; name: string; fromEmail: string; authType: string}>
  >([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<MailOauthServerConfig>(
    EMPTY_OAUTH_CONFIG,
  );
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('');
  const [addAccountVisible, setAddAccountVisible] = useState(false);
  const promptedThisFocus = useRef(false);

  const loadOAuthConfig = useCallback(async () => {
    try {
      const server = await getServerUrl();
      const config = await fetchMailOAuthConfig(server);
      setOauthConfig(config);
      return config;
    } catch (error) {
      setOauthConfig(EMPTY_OAUTH_CONFIG);
      setStatus(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, []);

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
        authType: a.config.authType,
      })),
    );
    const secretStatus = await getMailSecretsStatus(name);
    setSecretsLocked(secretStatus.locked && !secretStatus.inMemory);
    await loadOAuthConfig();
    return secretStatus.locked && !secretStatus.inMemory;
  }, [loadOAuthConfig]);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      setUnlocking(true);
      try {
        setStatus('');
        const name = identityName || (await getCurrentIdentityRequired());
        await unlockMailSecretsWithPin(name, pin);
        await appendActivityLog('Mail secrets unlocked', 'success');
        setStatus('Mail secrets unlocked');
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setUnlocking(false);
      }
    },
    [identityName, refresh],
  );

  const requestPinUnlock = useCallback(async () => {
    const pin = await promptSecret({
      title: 'Email PIN',
      placeholder: 'Email PIN',
      submitLabel: 'Unlock',
    });
    if (pin === null) {
      return;
    }
    if (!pin.trim()) {
      setStatus('Email PIN is required');
      return;
    }
    await unlockWithPin(pin);
  }, [promptSecret, unlockWithPin]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const requestPinUnlockRef = useRef(requestPinUnlock);
  requestPinUnlockRef.current = requestPinUnlock;

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
        await requestPinUnlockRef.current();
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    return subscribeMailOAuthCallbacks(async url => {
      try {
        const tokens = await completeMailOAuthFromUrl(url);
        const cfg = getOAuthProviderConfig(tokens.provider);
        const id = `oauth-${tokens.provider}-${Date.now()}`;
        await upsertMailAccount(identityName, {
          id,
          name: `${tokens.provider} ${tokens.email}`,
          config: {
            ...DEFAULT_MAIL_ACCOUNT,
            authType: 'oauth',
            oauthProvider: tokens.provider,
            username: tokens.email,
            fromEmail: tokens.email,
            imapHost: cfg.imapHost,
            imapPort: cfg.imapPort,
            imapSecure: cfg.imapSecure,
            smtpHost: cfg.smtpHost,
            smtpPort: cfg.smtpPort,
            smtpSecure: cfg.smtpSecure,
            persistSecrets: true,
          },
        });
        setMailSecretsInMemory(identityName, id, {
          imapPassword: tokens.email,
          smtpPassword: tokens.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.tokenExpiry,
        });
        await appendActivityLog(`Mail OAuth linked: ${tokens.email}`, 'success');
        setStatus(`Linked ${tokens.email}`);
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });
  }, [identityName, refresh]);

  const startOAuth = async (provider: MailOauthProvider) => {
    if (provider !== 'gmail' && provider !== 'outlook') {
      return;
    }
    try {
      setStatus('');
      const config = oauthConfig.gmail.configured || oauthConfig.outlook.configured
        ? oauthConfig
        : (await loadOAuthConfig()) ?? EMPTY_OAUTH_CONFIG;
      const override =
        provider === 'gmail'
          ? await getMailOauthGmailClientIdOverride()
          : await getMailOauthOutlookClientIdOverride();
      const clientId = resolveOAuthClientId(provider, config, override);
      const {authUrl} = await startMailOAuth(provider, clientId);
      await openMailOAuthBrowser(authUrl);
      setStatus('Complete sign-in in the browser…');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Screen scroll>
      {secretPrompt}
      <BusyOverlay visible={unlocking} message="Unlocking mail secrets…" />
      <Text style={styles.header}>Mail accounts ({identityName || '…'})</Text>
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
            onPress={() => void requestPinUnlock()}
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
                  subtitle={`${a.fromEmail} · ${
                    a.authType === 'oauth' ? 'OAuth' : 'Manual IMAP/SMTP'
                  }`}
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
        title="Add account"
        onPress={() => setAddAccountVisible(true)}
      />
      <AddAccountModal
        visible={addAccountVisible}
        onCancel={() => setAddAccountVisible(false)}
        onManual={() => {
          setAddAccountVisible(false);
          navigation.navigate('MailAccountSetup', {});
        }}
        onGmail={() => {
          setAddAccountVisible(false);
          startOAuth('gmail');
        }}
        onOutlook={() => {
          setAddAccountVisible(false);
          startOAuth('outlook');
        }}
      />
      <AppButton
        title="Open inbox"
        variant="secondary"
        onPress={() => navigation.navigate('MailInbox')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    fontWeight: '700',
    fontSize: typography.title,
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
