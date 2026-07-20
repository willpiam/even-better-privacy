import React, {useCallback, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import type {SigningType} from '../types';
import {getEnforcePasswordPolicy} from '../services/settings';
import {createIdentity} from '../services/storage';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SegmentedControl from '../components/SegmentedControl';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'CreateIdentity'>;

export default function CreateIdentityScreen({navigation}: Props): JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
      if (password !== confirm) {
        throw new Error('Passwords do not match');
      }
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
    <Screen scroll>
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="none" />
      <TextField
        label={
          enforcePasswordPolicy
            ? 'Password (12+ chars, mixed classes)'
            : 'Password'
        }
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
      />
      <SectionTitle>Signing type</SectionTitle>
      <SegmentedControl
        value={signingType}
        onChange={v => setSigningType(v as SigningType)}
        options={[
          {label: 'ML-DSA', value: 'dilithium'},
          {label: 'SLH-DSA', value: 'sphincs'},
        ]}
      />
      <StatusBanner
        message={
          enforcePasswordPolicy
            ? 'Password must meet the policy configured in Settings.'
            : 'Password policy is disabled in Settings.'
        }
        kind="info"
      />
      <StatusBanner message={status} kind={statusKind(status)} />
      <View style={styles.spacer} />
      <AppButton
        title={loading ? 'Creating…' : 'Create'}
        loading={loading}
        onPress={onCreate}
      />
      <AppButton
        title="Create from mnemonic (EBP-HD)"
        variant="secondary"
        onPress={() => navigation.navigate('HdCreate')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: {height: 8},
});
