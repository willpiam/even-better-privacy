import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
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
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import SectionTitle from '../../components/SectionTitle';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import Card from '../../components/Card';
import {statusKind} from '../../theme/statusKind';
import {colors, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailAccountSetup'>;

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
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

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
    setBusyMessage('Testing mail connection…');
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
      setBusyMessage(null);
    }
  };

  const onSave = async () => {
    if (isOAuth) {
      return;
    }
    setLoading(true);
    setBusyMessage('Saving mail account…');
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
      setBusyMessage(null);
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
      <Screen scroll>
        <SectionTitle>OAuth account</SectionTitle>
        <Card padded>
          <Text style={styles.readOnly}>{existing.name}</Text>
          <Text style={styles.readOnly}>{existing.config.fromEmail}</Text>
          <Text style={styles.readOnly}>
            Provider: {existing.config.oauthProvider}
          </Text>
          <Text style={styles.note}>
            OAuth-linked accounts cannot be edited here. Delete and re-link to
            change.
          </Text>
        </Card>
        <AppButton title="Delete account" variant="danger" onPress={onDelete} />
        <StatusBanner message={status} kind={statusKind(status)} />
      </Screen>
    );
  }

  const showEmailPin = persistSecrets && !pinInSession;

  return (
    <Screen scroll>
      <BusyOverlay visible={busyMessage !== null} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Account</SectionTitle>
      <TextField
        label="Account label"
        value={accountName}
        onChangeText={setAccountName}
        placeholder="Personal mail"
      />

      <SectionTitle>IMAP</SectionTitle>
      <TextField
        label="Host"
        autoCapitalize="none"
        autoCorrect={false}
        value={imapHost}
        onChangeText={setImapHost}
        placeholder="imap.example.com"
      />
      <TextField
        label="Port"
        keyboardType="number-pad"
        value={imapPort}
        onChangeText={setImapPort}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Use TLS/SSL</Text>
        <Switch value={imapSecure} onValueChange={setImapSecure} />
      </View>

      <SectionTitle>SMTP</SectionTitle>
      <TextField
        label="Host"
        autoCapitalize="none"
        autoCorrect={false}
        value={smtpHost}
        onChangeText={setSmtpHost}
        placeholder="smtp.example.com"
      />
      <TextField
        label="Port"
        keyboardType="number-pad"
        value={smtpPort}
        onChangeText={setSmtpPort}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Use TLS/SSL</Text>
        <Switch value={smtpSecure} onValueChange={setSmtpSecure} />
      </View>

      <SectionTitle>Credentials</SectionTitle>
      <TextField
        label="Username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
        placeholder="you@example.com"
      />
      <TextField
        label="IMAP password"
        secureTextEntry
        value={imapPassword}
        onChangeText={setImapPassword}
        placeholder={
          isEdit && hasExistingSecrets ? 'Leave blank to keep existing' : 'App password'
        }
      />
      <TextField
        label="SMTP password"
        secureTextEntry
        value={smtpPassword}
        onChangeText={setSmtpPassword}
        placeholder={
          isEdit && hasExistingSecrets ? 'Leave blank to keep existing' : 'App password'
        }
      />

      <SectionTitle>Sender</SectionTitle>
      <TextField
        label="From email"
        autoCapitalize="none"
        autoCorrect={false}
        value={fromEmail}
        onChangeText={setFromEmail}
        placeholder="you@example.com"
      />
      <TextField
        label="From name (optional)"
        value={fromName}
        onChangeText={setFromName}
        placeholder="Your Name"
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Persist passwords on this device</Text>
        <Switch value={persistSecrets} onValueChange={setPersistSecrets} />
      </View>

      {showEmailPin ? (
        <TextField
          label="Email PIN (encrypt at rest)"
          secureTextEntry
          value={emailPin}
          onChangeText={setEmailPin}
          placeholder="PIN used to encrypt stored passwords"
        />
      ) : null}

      <Text style={styles.note}>
        Mail credentials stay on this device. They are not sent to your EBP key
        server.
      </Text>

      <AppButton
        title={loading ? 'Testing…' : 'Test IMAP + SMTP'}
        variant="secondary"
        disabled={loading}
        onPress={onTest}
      />
      <AppButton
        title={loading ? 'Saving…' : 'Save mail account'}
        disabled={loading}
        onPress={onSave}
      />
      {isEdit ? (
        <AppButton title="Delete account" variant="danger" onPress={onDelete} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  switchLabel: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
    marginRight: spacing.sm,
  },
  note: {
    fontSize: 13,
    color: colors.muted,
  },
  readOnly: {
    fontSize: typography.body,
    color: colors.text,
    marginBottom: 6,
  },
});
