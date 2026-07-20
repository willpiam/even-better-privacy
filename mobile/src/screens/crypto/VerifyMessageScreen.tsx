import React, {useState} from 'react';
import {Text} from 'react-native';
import {verifyMessage} from '../../services/signVerify';
import {parseEbpPayloadInput} from '../../ebpCore';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function VerifyMessageScreen(): JSX.Element {
  const [verifyPayload, setVerifyPayload] = useState('');
  const [verifyMessageText, setVerifyMessageText] = useState('');
  const [verifyOutput, setVerifyOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onVerify = async () => {
    setBusyMessage('Verifying signature…');
    setStatus('');
    try {
      const payload = parseEbpPayloadInput(verifyPayload);
      const result = await verifyMessage({
        payload,
        message: verifyMessageText || undefined,
      });
      setVerifyOutput(result.verified ? 'Valid signature' : 'Invalid signature');
      setStatus('Verification complete');
    } catch (error) {
      setVerifyOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Signed payload"
        value={verifyPayload}
        onChangeText={setVerifyPayload}
        placeholder="Signed payload JSON"
        multiline
      />
      <TextField
        label="Detached message"
        value={verifyMessageText}
        onChangeText={setVerifyMessageText}
        placeholder="Detached message (if needed)"
        multiline
      />
      <AppButton
        title={busy ? 'Verifying…' : 'Verify Message'}
        onPress={onVerify}
        disabled={busy}
      />
      {verifyOutput ? <Text style={cryptoStyles.output}>{verifyOutput}</Text> : null}
    </Screen>
  );
}
