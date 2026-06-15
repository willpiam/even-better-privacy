import React, {useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {
  createHdIdentity,
  createHdMnemonic,
  discoverHdIdentities,
  verifyHdMnemonic,
} from '../services/hd';
import type {HdProfile} from '../ebpCore';

type Props = NativeStackScreenProps<RootStackParamList, 'HdCreate'>;

export default function HdCreateScreen({navigation}: Props): JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [confirmMnemonic, setConfirmMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [profile, setProfile] = useState<HdProfile>('dilithium');
  const [account, setAccount] = useState('0');
  const [index, setIndex] = useState('0');
  const [discoverOutput, setDiscoverOutput] = useState('');
  const [status, setStatus] = useState('');

  const onGenerate = () => {
    setMnemonic(createHdMnemonic(256));
    setStatus('Mnemonic generated — write it down before continuing');
  };

  const onCreate = async () => {
    try {
      if (mnemonic.trim() !== confirmMnemonic.trim()) {
        throw new Error('Mnemonic confirmation does not match');
      }
      if (!verifyHdMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
      }
      const created = await createHdIdentity({
        name,
        mnemonic,
        passphrase,
        password,
        profile,
        account: Number(account) || 0,
        index: Number(index) || 0,
      });
      setStatus(`Created HD identity ${created.name}`);
      navigation.replace('IdentityDetail', {identityName: created.name});
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onDiscover = async () => {
    try {
      const matches = await discoverHdIdentities({
        mnemonic,
        passphrase,
        profile,
        account: Number(account) || 0,
      });
      setDiscoverOutput(JSON.stringify(matches, null, 2));
      setStatus(`Discovery found ${matches.length} match(es)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>EBP-HD Identity</Text>
        <Button title="Generate mnemonic" onPress={onGenerate} />
        <TextInput
          style={[styles.input, styles.multi]}
          value={mnemonic}
          onChangeText={setMnemonic}
          placeholder="Mnemonic (24 words)"
          multiline
        />
        <TextInput
          style={[styles.input, styles.multi]}
          value={confirmMnemonic}
          onChangeText={setConfirmMnemonic}
          placeholder="Confirm mnemonic"
          multiline
        />
        <TextInput
          style={styles.input}
          value={passphrase}
          onChangeText={setPassphrase}
          placeholder="Optional passphrase"
          secureTextEntry
        />
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Identity name" />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Encryption password"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={profile}
          onChangeText={v => setProfile(v === 'sphincs' ? 'sphincs' : 'dilithium')}
          placeholder="Profile: dilithium or sphincs"
        />
        <TextInput style={styles.input} value={account} onChangeText={setAccount} placeholder="Account index" />
        <TextInput style={styles.input} value={index} onChangeText={setIndex} placeholder="Address index" />
        <Button title="Create HD identity" onPress={onCreate} />
        <Button title="Discover on server" onPress={onDiscover} />
        <TextInput style={[styles.input, styles.multi]} value={discoverOutput} editable={false} multiline />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  header: {fontWeight: '700', fontSize: 20, marginBottom: 12, color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    color: '#111',
  },
  multi: {minHeight: 80, textAlignVertical: 'top'},
  status: {marginTop: 10, color: '#111'},
});
