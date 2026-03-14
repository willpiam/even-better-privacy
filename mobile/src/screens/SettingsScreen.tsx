import React, {useEffect, useState} from 'react';
import {Button, SafeAreaView, StyleSheet, Text, TextInput} from 'react-native';
import {getServerUrl, setServerUrl} from '../services/settings';

export default function SettingsScreen(): JSX.Element {
  const [serverUrl, setServerUrlValue] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const value = await getServerUrl();
      setServerUrlValue(value);
    })();
  }, []);

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

  return (
    <SafeAreaView style={styles.container}>
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
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
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
  status: {marginTop: 12, color: '#111'},
});
