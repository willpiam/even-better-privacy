import React, {useCallback, useState} from 'react';
import {
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  deleteMailAccount,
  getMailPinInMemory,
  getMailSecretsInMemory,
  readMailStore,
  saveMailAccountWithSecrets,
} from '../../services/mail/accountStore';
import {
  newManualAccountDefaults,
  normalizeManualMailConfig,
  validateManualSecrets,
} from '../../services/mail/accountConfig';
import {testMailConnection} from '../../services/mail/mailTest';
import {clearMailTrace, mailStub} from '../../services/mail/mailTrace';
import {
  type MailAccountConfig,
  type MailAccountRecord,
} from '../../services/mail/types';
import {appendActivityLog} from '../../services/activityLog';

type Props = NativeStackScreenProps<RootStackParamList, 'MailAccountSetup'>;

export default function MailAccountSetupScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const accountId = route.params?.accountId;
  const isEdit = Boolean(accountId);

  const [identityName, setIdentityName] = useState('');
  const [existing, setExisting] = useState<MailAccountRecord | null>(null);
  const [isOAuth, setIsOAuth] = useState(false);
  const [hasExistingSecrets, setHasExistingSecrets] = useState(false);
  const [pinInSession, setPinInSession] = useState(false);

  const [accountName, setAccountName] = useState('Mail account');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [username, setUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [persistSecrets, setPersistSecrets] = useState(true);
  const [emailPin, setEmailPin] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const name = await getCurrentIdentityRequired();
    setIdentityName(name);
    setPinInSession(Boolean(getMailPinInMemory(name)));
    if (!accountId) {
      setExisting(null);
      setIsOAuth(false);
      setHasExistingSecrets(false);
      const defaults = newManualAccountDefaults();
      setAccountName('Mail account');
      setImapHost(defaults.imapHost);
      setImapPort(String(defaults.imapPort));
      setImapSecure(defaults.imapSecure);
      setSmtpHost(defaults.smtpHost);
      setSmtpPort(String(defaults.smtpPort));
      setSmtpSecure(defaults.smtpSecure);
      setUsername('');
      setFromEmail('');
      setFromName('');
      setPersistSecrets(true);
      return;
    }
    const store = await readMailStore(name);
    const record = store.accounts.find(a => a.id === accountId) ?? null;
    if (!record) {
      setStatus('Account not found');
      setExisting(null);
      return;
    }
    setExisting(record);
    const oauth = record.config.authType === 'oauth';
    setIsOAuth(oauth);
    setHasExistingSecrets(Boolean(getMailSecretsInMemory(name, record.id)));
    setAccountName(record.name);
    setImapHost(record.config.imapHost);
    setImapPort(String(record.config.imapPort));
    setImapSecure(record.config.imapSecure);
    setSmtpHost(record.config.smtpHost);
    setSmtpPort(String(record.config.smtpPort));
    setSmtpSecure(record.config.smtpSecure);
    setUsername(record.config.username);
    setFromEmail(record.config.fromEmail);
    setFromName(record.config.fromName);
    setPersistSecrets(record.config.persistSecrets);
  }, [accountId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const buildConfig = (): MailAccountConfig => {
    const base = existing?.config ?? newManualAccountDefaults();
    return normalizeManualMailConfig(base, {
      imapHost,
      imapPort: Number(imapPort),
      imapSecure,
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure,
      username,
      fromEmail,
      fromName,
      persistSecrets,
    });
  };

  const resolveSecretsForAction = () => {
    const existingSecrets = accountId
      ? getMailSecretsInMemory(identityName, accountId)
      : null;
    const nextImap =
      imapPassword.length > 0
        ? imapPassword
        : existingSecrets?.imapPassword ?? '';
    const nextSmtp =
      smtpPassword.length > 0
        ? smtpPassword
        : existingSecrets?.smtpPassword ?? '';
    validateManualSecrets(
      imapPassword,
      smtpPassword,
      !isEdit,
      Boolean(existingSecrets?.imapPassword && existingSecrets?.smtpPassword),
    );
    return {imapPassword: nextImap, smtpPassword: nextSmtp};
  };

  const onTest = async () => {
    if (isOAuth) {
      return;
    }
    setLoading(true);
    setStatus('');
    try {
      await clearMailTrace();
      const config = buildConfig();
      const secrets = resolveSecretsForAction();
      await testMailConnection(config, secrets);
      setStatus('Mail connection test passed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await mailStub('test.error', message);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  const onSave = async () => {
    if (isOAuth) {
      return;
    }
    setLoading(true);
    setStatus('');
    try {
      const config = buildConfig();
      const secrets = resolveSecretsForAction();
      const id = accountId ?? `pwd-${Date.now()}`;
      const pin =
        config.persistSecrets && !pinInSession
          ? emailPin
          : getMailPinInMemory(identityName) ?? undefined;
      if (config.persistSecrets && !pin) {
        throw new Error('Email PIN is required to persist encrypted mail passwords');
      }
      await saveMailAccountWithSecrets(identityName, {
        record: {
          id,
          name: accountName.trim() || 'Mail account',
          config,
        },
        imapPassword: secrets.imapPassword,
        smtpPassword: secrets.smtpPassword,
        pin,
      });
      await appendActivityLog(`Mail account saved: ${config.fromEmail}`, 'success');
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const onDelete = () => {
    if (!accountId) {
      return;
    }
    Alert.alert(
      'Delete mail account',
      `Remove ${accountName || fromEmail}?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMailAccount(identityName, accountId);
              await appendActivityLog(`Mail account deleted: ${fromEmail}`, 'success');
              navigation.goBack();
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          },
        },
      ],
    );
  };

  if (isEdit && isOAuth && existing) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.section}>OAuth account</Text>
          <Text style={styles.readOnly}>{existing.name}</Text>
          <Text style={styles.readOnly}>{existing.config.fromEmail}</Text>
          <Text style={styles.readOnly}>
            Provider: {existing.config.oauthProvider}
          </Text>
          <Text style={styles.note}>
            OAuth-linked accounts cannot be edited here. Delete and re-link to
            change.
          </Text>
          <Button title="Delete account" color="#c00" onPress={onDelete} />
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const showEmailPin = persistSecrets && !pinInSession;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Account</Text>
        <Text style={styles.fieldLabel}>Account label</Text>
        <TextInput
          style={styles.input}
          value={accountName}
          onChangeText={setAccountName}
          placeholder="Personal mail"
        />

        <Text style={styles.section}>IMAP</Text>
        <Text style={styles.fieldLabel}>Host</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={imapHost}
          onChangeText={setImapHost}
          placeholder="imap.example.com"
        />
        <Text style={styles.fieldLabel}>Port</Text>
        <TextInput
          keyboardType="number-pad"
          style={styles.input}
          value={imapPort}
          onChangeText={setImapPort}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Use TLS/SSL</Text>
          <Switch value={imapSecure} onValueChange={setImapSecure} />
        </View>

        <Text style={styles.section}>SMTP</Text>
        <Text style={styles.fieldLabel}>Host</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={smtpHost}
          onChangeText={setSmtpHost}
          placeholder="smtp.example.com"
        />
        <Text style={styles.fieldLabel}>Port</Text>
        <TextInput
          keyboardType="number-pad"
          style={styles.input}
          value={smtpPort}
          onChangeText={setSmtpPort}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Use TLS/SSL</Text>
          <Switch value={smtpSecure} onValueChange={setSmtpSecure} />
        </View>

        <Text style={styles.section}>Credentials</Text>
        <Text style={styles.fieldLabel}>Username</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="you@example.com"
        />
        <Text style={styles.fieldLabel}>IMAP password</Text>
        <TextInput
          secureTextEntry
          style={styles.input}
          value={imapPassword}
          onChangeText={setImapPassword}
          placeholder={
            isEdit && hasExistingSecrets ? 'Leave blank to keep existing' : 'App password'
          }
        />
        <Text style={styles.fieldLabel}>SMTP password</Text>
        <TextInput
          secureTextEntry
          style={styles.input}
          value={smtpPassword}
          onChangeText={setSmtpPassword}
          placeholder={
            isEdit && hasExistingSecrets ? 'Leave blank to keep existing' : 'App password'
          }
        />

        <Text style={styles.section}>Sender</Text>
        <Text style={styles.fieldLabel}>From email</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={fromEmail}
          onChangeText={setFromEmail}
          placeholder="you@example.com"
        />
        <Text style={styles.fieldLabel}>From name (optional)</Text>
        <TextInput
          style={styles.input}
          value={fromName}
          onChangeText={setFromName}
          placeholder="Your Name"
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Persist passwords on this device</Text>
          <Switch value={persistSecrets} onValueChange={setPersistSecrets} />
        </View>

        {showEmailPin ? (
          <>
            <Text style={styles.fieldLabel}>Email PIN (encrypt at rest)</Text>
            <TextInput
              secureTextEntry
              style={styles.input}
              value={emailPin}
              onChangeText={setEmailPin}
              placeholder="PIN used to encrypt stored passwords"
            />
          </>
        ) : null}

        <Text style={styles.note}>
          Mail credentials stay on this device. They are not sent to your EBP
          key server.
        </Text>

        <Button
          title={loading ? 'Testing…' : 'Test IMAP + SMTP'}
          disabled={loading}
          onPress={onTest}
        />
        <View style={styles.buttonSpacer} />
        <Button
          title={loading ? 'Saving…' : 'Save mail account'}
          disabled={loading}
          onPress={onSave}
        />
        {isEdit ? (
          <>
            <View style={styles.buttonSpacer} />
            <Button title="Delete account" color="#c00" onPress={onDelete} />
          </>
        ) : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16},
  section: {marginTop: 8, marginBottom: 8, fontWeight: '700', fontSize: 16, color: '#111'},
  fieldLabel: {fontSize: 13, color: '#333', marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    color: '#111',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  switchLabel: {flex: 1, color: '#111', marginRight: 8},
  note: {fontSize: 13, color: '#444', marginBottom: 12},
  readOnly: {fontSize: 14, color: '#111', marginBottom: 6},
  buttonSpacer: {height: 8},
  status: {marginTop: 12, color: '#111'},
});
