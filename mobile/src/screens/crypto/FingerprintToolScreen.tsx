import React, {useState} from 'react';
import {Text} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
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
      <AppButton
        title="Paste from clipboard"
        variant="secondary"
        onPress={() => {
          void Clipboard.getString().then(text => {
            if (text.trim()) {
              setPublicIdentityJson(text);
              setStatus('Pasted public identity');
            } else {
              setStatus('Clipboard is empty');
            }
          });
        }}
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
