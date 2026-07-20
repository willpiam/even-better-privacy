import React, {useCallback, useState} from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {pick, keepLocalCopy} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import {
  getEnforcePasswordPolicy,
  getMailIncludePublicKeys,
  getMailOauthGmailClientIdOverride,
  getMailOauthOutlookClientIdOverride,
  getMailRenderHtml,
  getServerUrl,
  setEnforcePasswordPolicy,
  setMailIncludePublicKeys,
  setMailOauthGmailClientIdOverride,
  setMailOauthOutlookClientIdOverride,
  setMailRenderHtml,
  setServerUrl,
} from '../services/settings';
import {verifyArgon2NobleParity} from '../services/argon2';
import {verifyMailPbkdf2Parity} from '../services/mail/pbkdf2Native';
import {BASE_DIR, importIdentity} from '../services/storage';
import {
  appendActivityLog,
  clearActivityLog,
  listActivityLog,
  type ActivityLogEntry,
} from '../services/activityLog';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import Card from '../components/Card';
import {statusKind} from '../theme/statusKind';
import {colors, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Settings'>;

export default function SettingsScreen(_props: Props): JSX.Element {
  const [serverUrl, setServerUrlValue] = useState('');
  const [enforcePasswordPolicy, setEnforcePasswordPolicyValue] = useState(true);
  const [mailRenderHtml, setMailRenderHtmlValue] = useState(false);
  const [mailIncludePublicKeys, setMailIncludePublicKeysValue] = useState(true);
  const [gmailOauthClientIdOverride, setGmailOauthClientIdOverride] = useState('');
  const [outlookOauthClientIdOverride, setOutlookOauthClientIdOverride] = useState('');
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [url, enforce, renderHtml, includeKeys, gmailOverride, outlookOverride, activity] =
          await Promise.all([
          getServerUrl(),
          getEnforcePasswordPolicy(),
          getMailRenderHtml(),
          getMailIncludePublicKeys(),
          getMailOauthGmailClientIdOverride(),
          getMailOauthOutlookClientIdOverride(),
          listActivityLog(),
        ]);
        setServerUrlValue(url);
        setEnforcePasswordPolicyValue(enforce);
        setMailRenderHtmlValue(renderHtml);
        setMailIncludePublicKeysValue(includeKeys);
        setGmailOauthClientIdOverride(gmailOverride);
        setOutlookOauthClientIdOverride(outlookOverride);
        setLogs(activity);
      })();
    }, []),
  );

  const onSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      await setServerUrl(serverUrl);
      await setMailOauthGmailClientIdOverride(gmailOauthClientIdOverride);
      await setMailOauthOutlookClientIdOverride(outlookOauthClientIdOverride);
      await appendActivityLog('Settings saved', 'success');
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const onImportIdentity = async () => {
    try {
      const [file] = await pick({mode: 'import'});
      const [copy] = await keepLocalCopy({
        destination: 'cachesDirectory',
        files: [{uri: file.uri, fileName: file.name ?? 'identity.json'}],
      });
      if (copy.status !== 'success') {
        throw new Error('Failed to copy identity file');
      }
      const path = copy.localUri.startsWith('file://')
        ? copy.localUri.replace('file://', '')
        : copy.localUri;
      const raw = await RNFS.readFile(path, 'utf8');
      const meta = await importIdentity({storageJson: raw});
      await appendActivityLog(`Imported identity ${meta.name}`, 'success');
      setStatus(`Imported ${meta.name}`);
      setLogs(await listActivityLog());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Key Server</SectionTitle>
      <TextField
        label="Server URL"
        autoCapitalize="none"
        autoCorrect={false}
        value={serverUrl}
        onChangeText={setServerUrlValue}
      />
      <AppButton
        title={loading ? 'Saving…' : 'Save'}
        loading={loading}
        disabled={loading}
        onPress={onSave}
      />

      <SectionTitle>Identity</SectionTitle>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Enforce password policy</Text>
        <Switch
          value={enforcePasswordPolicy}
          onValueChange={async value => {
            setEnforcePasswordPolicyValue(value);
            await setEnforcePasswordPolicy(value);
          }}
        />
      </View>
      <AppButton
        title="Import identity file"
        variant="secondary"
        onPress={onImportIdentity}
      />

      <SectionTitle>Mail preferences</SectionTitle>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Render HTML mail bodies</Text>
        <Switch
          value={mailRenderHtml}
          onValueChange={async value => {
            setMailRenderHtmlValue(value);
            await setMailRenderHtml(value);
          }}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Include public keys in EBP mail</Text>
        <Switch
          value={mailIncludePublicKeys}
          onValueChange={async value => {
            setMailIncludePublicKeysValue(value);
            await setMailIncludePublicKeys(value);
          }}
        />
      </View>

      <SectionTitle>Advanced</SectionTitle>
      <Text style={styles.advancedNote}>
        Mail OAuth client IDs are normally loaded from the key server. Override
        only for development.
      </Text>
      <TextField
        label="Gmail OAuth client ID override"
        autoCapitalize="none"
        autoCorrect={false}
        value={gmailOauthClientIdOverride}
        onChangeText={setGmailOauthClientIdOverride}
        placeholder="Optional"
      />
      <TextField
        label="Outlook OAuth client ID override"
        autoCapitalize="none"
        autoCorrect={false}
        value={outlookOauthClientIdOverride}
        onChangeText={setOutlookOauthClientIdOverride}
        placeholder="Optional"
      />

      <Text style={styles.systemLabel}>Identity Directory</Text>
      <Text style={styles.systemPath}>{BASE_DIR}</Text>

      <SectionTitle>Diagnostics</SectionTitle>
      <AppButton
        title="Verify Argon2 parity"
        variant="secondary"
        disabled={loading}
        onPress={async () => {
          setLoading(true);
          try {
            const result = await verifyArgon2NobleParity();
            const msg = result.ok
              ? 'Argon2 parity OK'
              : 'Argon2 parity FAILED';
            await appendActivityLog(msg, result.ok ? 'success' : 'error');
            setStatus(msg);
            setLogs(await listActivityLog());
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            setLoading(false);
          }
        }}
      />
      <AppButton
        title="Verify mail PBKDF2 parity"
        variant="secondary"
        disabled={loading}
        onPress={async () => {
          setLoading(true);
          try {
            const result = await verifyMailPbkdf2Parity();
            const msg = result.ok
              ? 'Mail PBKDF2 parity OK'
              : 'Mail PBKDF2 parity FAILED';
            await appendActivityLog(msg, result.ok ? 'success' : 'error');
            setStatus(msg);
            setLogs(await listActivityLog());
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            setLoading(false);
          }
        }}
      />

      <SectionTitle>Activity log</SectionTitle>
      <AppButton
        title="Clear log"
        variant="danger"
        onPress={async () => {
          await clearActivityLog();
          setLogs([]);
        }}
      />
      <Card padded>
        {logs.length === 0 ? (
          <Text style={styles.logLine}>No activity yet.</Text>
        ) : (
          logs.map(entry => (
            <Text style={styles.logLine} key={`${entry.at}-${entry.message}`}>
              [{entry.kind}] {new Date(entry.at).toLocaleString()} —{' '}
              {entry.message}
            </Text>
          ))
        )}
      </Card>
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
  advancedNote: {
    fontSize: 13,
    color: colors.muted,
  },
  systemLabel: {
    color: colors.muted,
    fontWeight: '600',
    fontSize: typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  systemPath: {
    fontSize: 12,
    color: colors.text,
  },
  logLine: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 4,
  },
});
