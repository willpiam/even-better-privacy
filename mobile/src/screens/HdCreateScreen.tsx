import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  createHdIdentity,
  createHdMnemonic,
  discoverHdIdentities,
  verifyHdMnemonic,
} from '../services/hd';
import type {HdProfile} from '../ebpCore';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SegmentedControl from '../components/SegmentedControl';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import Card from '../components/Card';
import {statusKind} from '../theme/statusKind';
import {colors} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'HdCreate'>;

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
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Working…');

  const onGenerate = () => {
    setMnemonic(createHdMnemonic(256));
    setStatus('Mnemonic generated — write it down before continuing');
  };

  const onCreate = async () => {
    setBusy(true);
    setBusyMessage('Creating HD identity…');
    setStatus('');
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
    } finally {
      setBusy(false);
    }
  };

  const onDiscover = async () => {
    setBusy(true);
    setBusyMessage('Discovering on server…');
    setStatus('');
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
    } finally {
      setBusy(false);
    }
  };

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <AppButton title="Generate mnemonic" variant="secondary" onPress={onGenerate} />
      {words.length >= 12 ? (
        <Card padded>
          <Text style={styles.hint}>
            Write these words down offline. You will confirm them below.
          </Text>
          <View style={styles.wordGrid}>
            {words.map((word, i) => (
              <Text key={`${i}-${word}`} style={styles.word}>
                {i + 1}. {word}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      <TextField
        label="Mnemonic"
        value={mnemonic}
        onChangeText={setMnemonic}
        multiline
        autoCapitalize="none"
      />
      <TextField
        label="Confirm mnemonic"
        value={confirmMnemonic}
        onChangeText={setConfirmMnemonic}
        multiline
        autoCapitalize="none"
      />
      <TextField
        label="Optional passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
      />
      <TextField label="Identity name" value={name} onChangeText={setName} autoCapitalize="none" />
      <TextField
        label="Encryption password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <SectionTitle>Profile</SectionTitle>
      <SegmentedControl
        value={profile}
        onChange={v => setProfile(v as HdProfile)}
        options={[
          {label: 'ML-DSA', value: 'dilithium'},
          {label: 'SLH-DSA', value: 'sphincs'},
        ]}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Account" value={account} onChangeText={setAccount} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label="Index" value={index} onChangeText={setIndex} keyboardType="number-pad" />
        </View>
      </View>
      <AppButton title="Create HD identity" onPress={onCreate} disabled={busy} />
      <AppButton title="Discover on server" variant="secondary" onPress={onDiscover} disabled={busy} />
      {discoverOutput ? (
        <TextField label="Discovery output" value={discoverOutput} editable={false} multiline />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {fontSize: 13, color: colors.accent, marginBottom: 10, lineHeight: 18},
  wordGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  word: {width: '47%', fontSize: 13, color: colors.text},
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
});
