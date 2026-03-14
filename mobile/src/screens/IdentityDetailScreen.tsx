import React, {useEffect, useState} from 'react';
import {Button, SafeAreaView, StyleSheet, Text, TextInput} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {listIdentities} from '../services/storage';
import {publishIdentity} from '../services/publish';
import {getServerUrl} from '../services/settings';
import type {StoredIdentityMeta} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IdentityDetail'>;

export default function IdentityDetailScreen({route}: Props): JSX.Element {
  const [identity, setIdentity] = useState<StoredIdentityMeta | null>(null);
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [all, server] = await Promise.all([
        listIdentities(),
        getServerUrl(),
      ]);
      setServerUrl(server);
      setIdentity(
        all.find(item => item.name === route.params.identityName) ?? null,
      );
    };
    load();
  }, [route.params.identityName]);

  const onPublish = async () => {
    setLoading(true);
    setStatus('');
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      if (!password) {
        throw new Error('Password is required');
      }
      const fingerprint = await publishIdentity({
        identityName: identity.name,
        password,
        server: serverUrl,
      });
      setStatus(`Published: ${fingerprint}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  if (!identity) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{color: '#111'}}>Identity not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.name}>{identity.name}</Text>
      <Text style={styles.line}>Fingerprint: {identity.fingerprint}</Text>
      <Text style={styles.line}>Signing: {identity.signingKeyType}</Text>
      <Text style={styles.line}>Encryption: {identity.encryptionKeyType}</Text>
      <Text style={styles.line}>Server: {serverUrl}</Text>
      <Text style={styles.label}>Password to decrypt and sign</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        style={styles.input}
      />
      <Button
        title={loading ? 'Publishing...' : 'Publish to key server'}
        onPress={onPublish}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  name: {fontWeight: '700', fontSize: 20, marginBottom: 8, color: '#111'},
  line: {marginBottom: 8, color: '#111'},
  label: {marginTop: 12, marginBottom: 4, color: '#111'},
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
