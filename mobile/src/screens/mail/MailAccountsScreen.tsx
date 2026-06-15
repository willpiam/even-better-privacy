import React, {useCallback, useEffect, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  readMailStore,
  selectMailAccount,
  setMailSecretsInMemory,
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

type Props = NativeStackScreenProps<RootStackParamList, 'MailAccounts'>;

const EMPTY_OAUTH_CONFIG: MailOauthServerConfig = {
  gmail: {clientId: '', configured: false},
  outlook: {clientId: '', configured: false},
};

export default function MailAccountsScreen({navigation}: Props): JSX.Element {
  const [identityName, setIdentityName] = useState('');
  const [accounts, setAccounts] = useState<
    Array<{id: string; name: string; fromEmail: string}>
  >([]);
  const [oauthConfig, setOauthConfig] = useState<MailOauthServerConfig>(
    EMPTY_OAUTH_CONFIG,
  );
  const [pin, setPin] = useState('');
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
    setAccounts(
      store.accounts.map(a => ({
        id: a.id,
        name: a.name,
        fromEmail: a.config.fromEmail || a.config.username,
      })),
    );
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

  const addPasswordAccount = async () => {
    try {
      const id = `pwd-${Date.now()}`;
      await upsertMailAccount(identityName, {
        id,
        name: 'IMAP account',
        config: {
          ...DEFAULT_MAIL_ACCOUNT,
          authType: 'password',
          username: 'user@example.com',
          fromEmail: 'user@example.com',
          imapHost: 'imap.example.com',
          smtpHost: 'smtp.example.com',
          persistSecrets: true,
        },
      });
      setMailSecretsInMemory(
        identityName,
        id,
        {imapPassword: pin, smtpPassword: pin},
        pin,
      );
      setStatus('Password account added (edit hosts in a future settings panel)');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>Mail accounts ({identityName})</Text>
        {accounts.map(a => (
          <Button
            key={a.id}
            title={`${a.name} — ${a.fromEmail}`}
            onPress={async () => {
              await selectMailAccount(identityName, a.id);
              navigation.navigate('MailInbox');
            }}
          />
        ))}
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          placeholder="PIN / app password for IMAP"
          secureTextEntry
        />
        <Button title="Link Gmail (OAuth)" onPress={() => startOAuth('gmail')} />
        <Button title="Link Outlook (OAuth)" onPress={() => startOAuth('outlook')} />
        <Button title="Add password IMAP (manual hosts)" onPress={addPasswordAccount} />
        <Button title="Open inbox" onPress={() => navigation.navigate('MailInbox')} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  header: {fontWeight: '700', fontSize: 18, marginBottom: 12, color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    color: '#111',
  },
  status: {marginTop: 10, color: '#111'},
});
