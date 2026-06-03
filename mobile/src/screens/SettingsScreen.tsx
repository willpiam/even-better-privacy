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
import {
  getEnforcePasswordPolicy,
  getServerUrl,
  setEnforcePasswordPolicy,
  setServerUrl,
} from '../services/settings';
import {BASE_DIR} from '../services/storage';

export default function SettingsScreen(): JSX.Element {
  const [serverUrl, setServerUrlValue] = useState('');
  const [enforcePasswordPolicy, setEnforcePasswordPolicyValue] = useState(true);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [url, enforce] = await Promise.all([
          getServerUrl(),
          getEnforcePasswordPolicy(),
        ]);
        setServerUrlValue(url);
        setEnforcePasswordPolicyValue(enforce);
      })();
    }, []),
  );

  const onSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      await setServerUrl(serverUrl);
      setStatus('Saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  const onTogglePasswordPolicy = async (value: boolean) => {
    setEnforcePasswordPolicyValue(value);
    try {
      await setEnforcePasswordPolicy(value);
      setStatus(value ? 'Password policy enabled' : 'Password policy disabled');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      setEnforcePasswordPolicyValue(!value);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Key Server</Text>
        <Text style={styles.label}>Key Server URL</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={setServerUrlValue}
          style={styles.input}
        />
        <Button
          title={loading ? 'Saving...' : 'Save'}
          disabled={loading}
          onPress={onSave}
        />

        <Text style={styles.section}>Identity</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Enforce password policy</Text>
            <Text style={styles.switchHint}>
              When off, new identity passwords may be any non-empty value (weaker
              security).
            </Text>
          </View>
          <Switch
            value={enforcePasswordPolicy}
            onValueChange={onTogglePasswordPolicy}
          />
        </View>

        <Text style={styles.systemLabel}>Identity Directory</Text>
        <Text style={styles.systemPath}>{BASE_DIR}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16},
  section: {
    marginTop: 8,
    marginBottom: 8,
    fontWeight: '700',
    fontSize: 16,
    color: '#111',
  },
  label: {marginBottom: 6, color: '#111'},
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
    marginBottom: 16,
    gap: 12,
  },
  switchText: {flex: 1},
  switchLabel: {fontWeight: '600', color: '#111', marginBottom: 4},
  switchHint: {fontSize: 12, color: '#555', lineHeight: 18},
  systemLabel: {marginTop: 8, marginBottom: 4, color: '#333', fontWeight: '600'},
  systemPath: {fontSize: 12, color: '#333'},
  status: {marginTop: 12, color: '#111'},
});
