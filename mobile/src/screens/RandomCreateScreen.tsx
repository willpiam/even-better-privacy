import React, {useState} from 'react';
import {Alert, StyleSheet, Switch, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {createRandomIdentity} from '../services/identity';
import type {SigningType} from '../types';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SegmentedControl from '../components/SegmentedControl';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import {statusKind} from '../theme/statusKind';
import {colors} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'RandomCreate'>;

export default function RandomCreateScreen({navigation}: Props): JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [signingType, setSigningType] = useState<SigningType>('dilithium');
  const [overwrite, setOverwrite] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const runCreate = async () => {
    setBusy(true);
    setStatus('');
    try {
      const created = await createRandomIdentity({
        name,
        password,
        signingType,
        overwrite,
      });
      setStatus(`Created identity ${created.name}`);
      navigation.replace('IdentityDetail', {identityName: created.name});
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () => {
    if (overwrite) {
      Alert.alert(
        'Overwrite identity?',
        `Replace any existing identity named "${name.trim()}"?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Overwrite', style: 'destructive', onPress: () => void runCreate()},
        ],
      );
      return;
    }
    void runCreate();
  };

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message="Creating identity…" />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Identity name"
        testID="random-identity-name"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
      />
      <TextField
        label="Encryption password"
        testID="random-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <SectionTitle>Signing</SectionTitle>
      <SegmentedControl
        testID="random-signing"
        value={signingType}
        onChange={v => setSigningType(v as SigningType)}
        options={[
          {label: 'ML-DSA', value: 'dilithium'},
          {label: 'SLH-DSA', value: 'sphincs'},
        ]}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Overwrite if exists</Text>
        <Switch
          testID="random-overwrite"
          value={overwrite}
          onValueChange={setOverwrite}
        />
      </View>
      <AppButton
        title="Create identity"
        testID="random-create-submit"
        onPress={onCreate}
        disabled={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchLabel: {flex: 1, marginRight: 12, color: colors.text},
});
