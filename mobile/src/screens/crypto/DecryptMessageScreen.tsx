import React, {useState} from 'react';
import {decryptMessage} from '../../services/encryptDecrypt';
import {parseEbpPayloadInput} from '../../ebpCore';
import {getCurrentIdentityRequired} from '../../services/storage';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';

export default function DecryptMessageScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [decryptPayload, setDecryptPayload] = useState('');
  const [decryptSender, setDecryptSender] = useState('');
  const [decryptOutput, setDecryptOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onDecrypt = async () => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password',
      submitLabel: 'Decrypt',
    });
    if (password === null) {
      return;
    }
    setBusyMessage('Decrypting message…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = parseEbpPayloadInput(decryptPayload);
      const result = await decryptMessage({
        identityName,
        password,
        payload,
        sender: decryptSender || undefined,
      });
      setDecryptOutput(`Verify: ${result.verifyStatus}\n\n${result.message}`);
      setStatus('Message decrypted');
    } catch (error) {
      setDecryptOutput('');
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
      <TextField
        label="Encrypted payload"
        value={decryptPayload}
        onChangeText={setDecryptPayload}
        placeholder="Encrypted payload JSON"
        multiline
      />
      <TextField
        label="Sender"
        value={decryptSender}
        onChangeText={setDecryptSender}
        placeholder="Sender (for signed payloads)"
      />
      <AppButton
        title={busy ? 'Decrypting…' : 'Decrypt Message'}
        onPress={onDecrypt}
        disabled={busy}
      />
      <TextField
        label="Decrypted output"
        value={decryptOutput}
        editable={false}
        multiline
      />
    </Screen>
  );
}
