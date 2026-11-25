import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList, MoreStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {getServerUrl} from '../../services/settings';
import {
  deleteEbpMailbox,
  fetchEbpSignupConfig,
  resetEbpMailbox,
} from '../../services/mail/ebpSignup';
import {
  isManagedMailAddress,
  PRODUCTION_KEY_SERVER,
  TEST_MAIL_DOMAIN,
} from '../../services/mail/ebpSignupLogic';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {
  deleteMailAccount,
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
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import SectionTitle from '../../components/SectionTitle';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {colors, spacing, typography} from '../../theme/tokens';

type Props =
  | NativeStackScreenProps<MailStackParamList, 'MailAccountSetup'>
  | NativeStackScreenProps<MoreStackParamList, 'MailAccountSetup'>;

export default function MailAccountSetupScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const accountId = route.params?.accountId;
  const isEdit = Boolean(accountId);
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();

  const [identityName, setIdentityName] = useState('');
  const [server, setServer] = useState('');
  const [managedDomain, setManagedDomain] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [existing, setExisting] = useState<MailAccountRecord | null>(null);
  const [hasExistingSecrets, setHasExistingSecrets] = useState(false);


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

  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const name = await getCurrentIdentityRequired();
    setIdentityName(name);

    const url = await getServerUrl().catch(() => '');
    setServer(url);
    setManagedDomain('');
    if (!accountId) {
      setExisting(null);
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

    const email = record.config.fromEmail;
    const testMode = isManagedMailAddress(email, TEST_MAIL_DOMAIN);
    if (url === PRODUCTION_KEY_SERVER) {
      setManagedDomain(testMode ? TEST_MAIL_DOMAIN : 'pqpost.com');
    } else if (url) {
      const cfg = await fetchEbpSignupConfig(url, testMode).catch(() => null);
      setManagedDomain(cfg?.enabled ? cfg.domain : '');
    }
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
    setLoading(true);
    setBusyMessage('Connecting IMAP…');
    setStatus('');
    try {
      await clearMailTrace();
      const config = buildConfig();
      const secrets = resolveSecretsForAction();
      await testMailConnection(config, secrets, {
        onProgress: step => setBusyMessage(step),
      });
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
    setLoading(true);
    setBusyMessage('Saving mail account…');
    setStatus('');
    try {
      const config = buildConfig();
      const secrets = resolveSecretsForAction();
      const id = accountId ?? `pwd-${Date.now()}`;
      if (!(await ensureUnlocked(identityName))) return;
      await saveMailAccountWithSecrets(identityName, {
        record: {
          id,
          name: accountName.trim() || 'Mail account',
          config,
        },
        imapPassword: secrets.imapPassword,
        smtpPassword: secrets.smtpPassword,
      });
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setBusyMessage(null);
    }
  };

  const promptIdentityPassword = async (): Promise<string | null> => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password',
      submitLabel: 'Continue',
    });
    if (password === null) {
      return null;
    }
    if (!password.trim()) {
      setStatus('Identity password is required');
      return null;
    }
    return password;
  };

  const onRestoreMailbox = async () => {
    const password = await promptIdentityPassword();
    if (!password) {
      return;
    }
    setLoading(true);
    setBusyMessage('Restoring mailbox access…');
    setStatus('');
    try {
      const cfg = await fetchEbpSignupConfig(
        server,
        isManagedMailAddress(managedEmail, TEST_MAIL_DOMAIN),
      );
      const res = await resetEbpMailbox({
        identityName,
        password,
        server,
        config: cfg,
        expectedEmail: managedEmail,
        accountId,
        fromName,
      });
      setStatus(`Mailbox access restored for ${res.email}`);
      setImapPassword('');
      setSmtpPassword('');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setBusyMessage(null);
    }
  };

  const onDeleteMailbox = async () => {
    if (!managedEmail) return;
    const password = await promptIdentityPassword();
    if (!password) {
      return;
    }
    setLoading(true);
    setBusyMessage('Deleting mailbox…');
    setStatus('');
    try {
      await deleteEbpMailbox({
        identityName,
        password,
        server,
        email: managedEmail,
        confirm: deleteConfirm,
      });
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
      'Remove account from device',
      `Remove ${accountName || fromEmail}?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMailAccount(identityName, accountId);
              navigation.goBack();
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          },
        },
      ],
    );
  };

  const savedEmail = existing?.config.fromEmail ?? '';
  const managedEmail = isManagedMailAddress(savedEmail, managedDomain)
    ? savedEmail
    : '';

  return (
    <Screen scroll>
      {secretPrompt}
      {unlockPrompt}
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
        keyboardType="url"
        spellCheck={false}
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
        keyboardType="url"
        spellCheck={false}
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
        keyboardType="email-address"
        spellCheck={false}
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
        keyboardType="email-address"
        spellCheck={false}
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
      {isEdit && managedEmail ? (
        <>
          <AppButton
            title="Restore mailbox access"
            testID="mail-restore-access"
            variant="secondary"
            disabled={loading}
            onPress={() => void onRestoreMailbox()}
          />
          <TextField
            label={`Type ${managedEmail} to delete the mailbox on the server`}
            testID="mail-delete-confirm"
            keyboardType="email-address"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect={false}
            value={deleteConfirm}
            onChangeText={setDeleteConfirm}
          />
          <AppButton
            title="Delete mailbox"
            testID="mail-delete-mailbox"
            variant="danger"
            disabled={loading || deleteConfirm.trim().toLowerCase() !== managedEmail.toLowerCase()}
            onPress={() => void onDeleteMailbox()}
          />
        </>
      ) : null}
      {isEdit ? (
        <AppButton title="Remove account from device" variant="danger" onPress={onDelete} />
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
});
