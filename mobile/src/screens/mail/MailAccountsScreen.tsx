import React, {useCallback, useEffect, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
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
import BusyOverlay from '../../components/BusyOverlay';

type Props = NativeStackScreenProps<RootStackParamList, 'MailAccounts'>;

const EMPTY_OAUTH_CONFIG: MailOauthServerConfig = {
  gmail: {clientId: '', configured: false},
  outlook: {clientId: '', configured: false},
};

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const [identityName, setIdentityName] = useState('');
  const [accounts, setAccounts] = useState<
    Array<{id: string; name: string; fromEmail: string; authType: string}>
  >([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<MailOauthServerConfig>(
    EMPTY_OAUTH_CONFIG,
  );
  const [unlockPin, setUnlockPin] = useState('');
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('');

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
  }, [loadOAuthConfig]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
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

  const onUnlock = async () => {
    if (!unlockPin.trim()) {
      setStatus('Email PIN is required');
      return;
    }
    setUnlocking(true);
    try {
      setStatus('');
      const name = identityName || (await getCurrentIdentityRequired());
      await unlockMailSecretsWithPin(name, unlockPin);
      setUnlockPin('');
      await appendActivityLog('Mail secrets unlocked', 'success');
      setStatus('Mail secrets unlocked');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <BusyOverlay visible={unlocking} message="Unlocking mail secrets…" />
      <ScrollView>
        <Text style={styles.header}>Mail accounts ({identityName})</Text>
        {accounts.map(a => {
          const selected = a.id === selectedAccountId;
          return (
            <View
              key={a.id}
              style={[styles.accountRow, selected && styles.accountRowSelected]}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('MailAccountSetup', {accountId: a.id})
                }>
                <Text style={styles.accountTitle}>
                  {a.name} — {a.fromEmail}
                  {selected ? ' (selected)' : ''}
                </Text>
                <Text style={styles.accountMeta}>
                  {a.authType === 'oauth' ? 'OAuth' : 'Manual IMAP/SMTP'} · Tap to edit
                </Text>
              </TouchableOpacity>
              <View style={styles.accountActions}>
                <Button
                  title="Select"
                  onPress={async () => {
                    await selectMailAccount(identityName, a.id);
                    await refresh();
                  }}
                />
              </View>
            </View>
          );
        })}

        {secretsLocked ? (
          <View style={styles.unlockSection}>
            <Text style={styles.sectionLabel}>
              Unlock stored mail passwords with your email PIN
            </Text>
            <TextInput
              style={styles.input}
              value={unlockPin}
              onChangeText={setUnlockPin}
              placeholder="Email PIN"
              secureTextEntry
            />
            <Button
              title={unlocking ? 'Unlocking…' : 'Unlock mail secrets'}
              disabled={unlocking}
              onPress={onUnlock}
            />
          </View>
        ) : null}

        <View style={styles.buttonSpacer} />
        <Button
          title="Add manual account"
          onPress={() => navigation.navigate('MailAccountSetup', {})}
        />
        <View style={styles.buttonSpacer} />
        <Button title="Link Gmail (OAuth)" onPress={() => startOAuth('gmail')} />
        <Button title="Link Outlook (OAuth)" onPress={() => startOAuth('outlook')} />
        <View style={styles.buttonSpacer} />
        <Button title="Open inbox" onPress={() => navigation.navigate('MailInbox')} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  header: {fontWeight: '700', fontSize: 18, marginBottom: 12, color: '#111'},
  accountRow: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  accountRowSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#f0f6ff',
  },
  accountTitle: {fontWeight: '600', color: '#111', marginBottom: 4},
  accountMeta: {fontSize: 12, color: '#555', marginBottom: 8},
  accountActions: {alignSelf: 'flex-start'},
  unlockSection: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#fffbeb',
  },
  sectionLabel: {color: '#111', marginBottom: 8},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    color: '#111',
  },
  buttonSpacer: {height: 8},
  status: {marginTop: 10, color: '#111'},
});
