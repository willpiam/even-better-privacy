import React, {useCallback, useState} from 'react';
import {
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
import {BASE_DIR, importIdentity, runCoreSelfTest} from '../services/storage';
import {
  appendActivityLog,
  clearActivityLog,
  listActivityLog,
  type ActivityLogEntry,
} from '../services/activityLog';

export default function SettingsScreen(): JSX.Element {
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
      const path = copy.uri.startsWith('file://')
        ? copy.uri.replace('file://', '')
        : copy.uri;
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
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Key Server</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={setServerUrlValue}
          style={styles.input}
        />
        <Button title={loading ? 'Saving...' : 'Save'} disabled={loading} onPress={onSave} />

        <Text style={styles.section}>Identity</Text>
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
        <Button title="Import identity file" onPress={onImportIdentity} />

        <Text style={styles.section}>Mail preferences</Text>
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

        <Text style={styles.section}>Advanced</Text>
        <Text style={styles.advancedNote}>
          Mail OAuth client IDs are normally loaded from the key server. Override
          only for development.
        </Text>
        <Text style={styles.fieldLabel}>Gmail OAuth client ID override</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={gmailOauthClientIdOverride}
          onChangeText={setGmailOauthClientIdOverride}
          placeholder="Optional"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>Outlook OAuth client ID override</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={outlookOauthClientIdOverride}
          onChangeText={setOutlookOauthClientIdOverride}
          placeholder="Optional"
          style={styles.input}
        />

        <Text style={styles.systemLabel}>Identity Directory</Text>
        <Text style={styles.systemPath}>{BASE_DIR}</Text>

        <Text style={styles.section}>Diagnostics</Text>
        <Button
          title="Run core self-test"
          disabled={loading}
          onPress={async () => {
            setLoading(true);
            try {
              const msg = await runCoreSelfTest();
              await appendActivityLog(msg, 'success');
              setStatus(msg);
              setLogs(await listActivityLog());
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            } finally {
              setLoading(false);
            }
          }}
        />
        <Button
          title="Verify Argon2 parity"
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

        <Text style={styles.section}>Activity log</Text>
        <Button
          title="Clear log"
          onPress={async () => {
            await clearActivityLog();
            setLogs([]);
          }}
        />
        {logs.map(entry => (
          <Text style={styles.logLine} key={`${entry.at}-${entry.message}`}>
            [{entry.kind}] {new Date(entry.at).toLocaleString()} — {entry.message}
          </Text>
        ))}

        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16},
  section: {marginTop: 8, marginBottom: 8, fontWeight: '700', fontSize: 16, color: '#111'},
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
  advancedNote: {fontSize: 13, color: '#444', marginBottom: 12},
  fieldLabel: {fontSize: 13, color: '#333', marginBottom: 4},
  systemLabel: {marginTop: 8, marginBottom: 4, color: '#333', fontWeight: '600'},
  systemPath: {fontSize: 12, color: '#333', marginBottom: 12},
  logLine: {fontSize: 11, color: '#333', marginBottom: 4},
  status: {marginTop: 12, color: '#111'},
});
