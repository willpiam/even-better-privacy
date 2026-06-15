import React, {useCallback, useState} from 'react';
import {
  Button,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import type {SigningType} from '../types';
import {getEnforcePasswordPolicy} from '../services/settings';
import {createIdentity} from '../services/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateIdentity'>;

export default function CreateIdentityScreen({navigation}: Props): JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [signingType, setSigningType] = useState<SigningType>('dilithium');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [enforcePasswordPolicy, setEnforcePasswordPolicy] = useState(true);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setEnforcePasswordPolicy(await getEnforcePasswordPolicy());
      })();
    }, []),
  );

  const onCreate = async () => {
    setLoading(true);
    setStatus('');
    try {
      const created = await createIdentity({name, password, signingType});
      setStatus(`Created ${created.name}`);
      navigation.replace('IdentityDetail', {identityName: created.name});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Identity Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={styles.input}
        autoCapitalize="none"
      />
      <Text style={styles.label}>
        {enforcePasswordPolicy
          ? 'Password (12+ chars, 3 of 4: upper, lower, digit, symbol)'
          : 'Password (required; policy disabled in Settings)'}
      </Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
      />
      <Text style={styles.label}>Signing Type</Text>
      <View style={styles.row}>
        <Button
          title={signingType === 'dilithium' ? 'Dilithium ✓' : 'Dilithium'}
          onPress={() => setSigningType('dilithium')}
        />
        <Button
          title={signingType === 'sphincs' ? 'Sphincs ✓' : 'Sphincs'}
          onPress={() => setSigningType('sphincs')}
        />
      </View>
      <Button
        title={loading ? 'Creating...' : 'Create'}
        disabled={loading}
        onPress={onCreate}
      />
      <Button title="Create from mnemonic (EBP-HD)" onPress={() => navigation.navigate('HdCreate')} />
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  label: {marginTop: 8, marginBottom: 4, color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
    color: '#111',
  },
  status: {marginTop: 12, color: '#111'},
});
