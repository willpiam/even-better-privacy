import React, {useState} from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import {decryptMessage} from '../../services/encryptDecrypt';
import {parseEbpPayloadInput} from '../../ebpCore';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {statusKind} from '../../theme/statusKind';

export default function DecryptMessageScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [decryptPayload, setDecryptPayload] = useState('');
  const [decryptSender, setDecryptSender] = useState('');
  const [decryptOutput, setDecryptOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onDecrypt = async () => {
    setStatus('');
    try {
      const identityName = await ensureUnlocked();
      if (!identityName) {
        return;
      }
      setBusyMessage('Decrypting message…');
      const payload = parseEbpPayloadInput(decryptPayload);
      const result = await decryptMessage({
        identityName,
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
      {unlockPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Encrypted payload"
        value={decryptPayload}
        onChangeText={setDecryptPayload}
        placeholder="Encrypted payload JSON"
        multiline
      />
      <AppButton
        title="Paste from clipboard"
        variant="secondary"
        onPress={() => {
          void Clipboard.getString().then(text => {
            if (text.trim()) {
              setDecryptPayload(text);
              setStatus('Pasted payload');
            } else {
              setStatus('Clipboard is empty');
            }
          });
        }}
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
