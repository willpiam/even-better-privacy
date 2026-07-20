import React, {useState} from 'react';
import {Text} from 'react-native';
import {fingerprintFromPublicIdentity} from '../../services/identityHelpers';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function FingerprintToolScreen(): JSX.Element {
  const [publicIdentityJson, setPublicIdentityJson] = useState('');
  const [computedFingerprint, setComputedFingerprint] = useState('');
  const [status, setStatus] = useState('');

  const onFingerprintFromPublic = () => {
    try {
      const parsed = JSON.parse(publicIdentityJson) as Record<string, unknown>;
      const fp = fingerprintFromPublicIdentity(parsed);
      setComputedFingerprint(fp);
      setStatus('Fingerprint computed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setComputedFingerprint('');
    }
  };

  return (
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Public identity JSON"
        value={publicIdentityJson}
        onChangeText={setPublicIdentityJson}
        placeholder="Public identity JSON"
        multiline
      />
      <AppButton title="Compute fingerprint" onPress={onFingerprintFromPublic} />
      {computedFingerprint ? (
        <Text style={cryptoStyles.output} selectable>
          {computedFingerprint}
        </Text>
      ) : null}
    </Screen>
  );
}
