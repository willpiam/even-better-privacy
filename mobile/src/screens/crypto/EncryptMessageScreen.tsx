import React, {useState} from 'react';
import {Switch, Text, View} from 'react-native';
import Share from 'react-native-share';
import {encryptMessage} from '../../services/encryptDecrypt';
import {getCurrentIdentityRequired} from '../../services/storage';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import ContactPicker from '../../components/ContactPicker';
import CopyableOutput from '../../components/CopyableOutput';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function EncryptMessageScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sign, setSign] = useState(false);
  const [encryptOutput, setEncryptOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onEncrypt = async () => {
    let password: string | undefined;
    if (sign) {
      const entered = await promptSecret({
        title: 'Identity password',
        placeholder: 'Identity password',
        submitLabel: 'Encrypt',
      });
      if (entered === null) {
        return;
      }
      password = entered;
    }
    setBusyMessage('Encrypting message…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await encryptMessage({
        identityName,
        password,
        message,
        recipient,
        sign,
      });
      setEncryptOutput(JSON.stringify(payload, null, 2));
      setStatus('Message encrypted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <ContactPicker
        value={recipient}
        onChange={setRecipient}
        placeholder="Recipient (name or fingerprint)"
      />
      <TextField
        label="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="Message"
        multiline
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Sign with identity</Text>
        <Switch value={sign} onValueChange={setSign} />
      </View>
      <AppButton
        title={busy ? 'Encrypting…' : 'Encrypt Message'}
        onPress={onEncrypt}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => {
          if (encryptOutput) {
            void Share.open({message: encryptOutput, failOnCancel: false});
          }
        }}
      />
      <CopyableOutput
        value={encryptOutput}
        placeholder="Encrypted message payload…"
      />
    </Screen>
  );
}
