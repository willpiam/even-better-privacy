import React, {useCallback, useState} from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {
  getCurrentIdentity,
  listIdentities,
  runCoreSelfTest,
  setCurrentIdentity,
} from '../services/storage';
import type {StoredIdentityMeta} from '../types';
import {getServerUrl} from '../services/settings';
import {PROTOCOL_VERSION} from '../../../core/version';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({navigation}: Props): JSX.Element {
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [currentIdentity, setCurrentIdentityValue] = useState<string | null>(
    null,
  );
  const [serverUrl, setServerUrl] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const currentFingerprint =
    identities.find(item => item.name === currentIdentity)?.fingerprint ?? '-';

  const refresh = useCallback(async () => {
    const [list, current, server] = await Promise.all([
      listIdentities(),
      getCurrentIdentity(),
      getServerUrl(),
    ]);
    setIdentities(list);
    setCurrentIdentityValue(current);
    setServerUrl(server);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const runSelfTest = async () => {
    try {
      const result = await runCoreSelfTest();
      setStatus(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Core test failed: ${message}`);
    }
  };

  const onSelectIdentity = async (name: string) => {
    await setCurrentIdentity(name);
    setCurrentIdentityValue(name);
    navigation.navigate('IdentityDetail', {identityName: name});
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Server: {serverUrl}</Text>
      <Text style={styles.label}>Identity: {currentIdentity ?? '-'}</Text>
      <Text style={styles.label}>Fingerprint: {currentFingerprint}</Text>
      <Text style={styles.label}>Protocol: {PROTOCOL_VERSION}</Text>
      <View style={styles.row}>
        <Button
          title="Create Identity"
          onPress={() => navigation.navigate('CreateIdentity')}
        />
        <Button title="EBP-HD" onPress={() => navigation.navigate('HdCreate')} />
        <Button
          title="Settings"
          onPress={() => navigation.navigate('Settings')}
        />
      </View>
      <View style={styles.row}>
        <Button title="Run Core Self-Test" onPress={runSelfTest} />
      </View>
      <View style={styles.row}>
        <Button title="Contacts" onPress={() => navigation.navigate('Contacts')} />
        <Button title="Sign / Verify" onPress={() => navigation.navigate('SignVerify')} />
      </View>
      <View style={styles.row}>
        <Button
          title="Encrypt / Decrypt"
          onPress={() => navigation.navigate('EncryptDecrypt')}
        />
        <Button
          title="Certificates"
          onPress={() => navigation.navigate('Certificates')}
        />
        <Button title="Mail" onPress={() => navigation.navigate('MailAccounts')} />
      </View>
      <View style={styles.row}>
        <Button
          title="Project Info"
          onPress={() => navigation.navigate('ProjectInfo')}
        />
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Text style={styles.header}>Local Identities</Text>
      <FlatList
        data={identities}
        keyExtractor={item => item.name}
        ListEmptyComponent={<Text style={{color: '#111'}}>No identities yet.</Text>}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => onSelectIdentity(item.name)}>
            <Text style={styles.name}>
              {item.name}
              {item.name === currentIdentity ? ' (current)' : ''}
            </Text>
            <Text style={styles.fingerprint}>{item.fingerprint}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  label: {marginBottom: 12, color: '#111'},
  status: {marginBottom: 12, color: '#111'},
  header: {fontWeight: '700', fontSize: 18, marginBottom: 8, color: '#111'},
  item: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  name: {fontWeight: '700', color: '#111'},
  fingerprint: {marginTop: 4, fontSize: 12, color: '#333'},
});
