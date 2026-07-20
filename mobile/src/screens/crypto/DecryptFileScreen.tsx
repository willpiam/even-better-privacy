import React, {useState} from 'react';
import {decryptFile} from '../../services/encryptDecrypt';
import {parseEbpPayloadInput} from '../../ebpCore';
import {getCurrentIdentityRequired} from '../../services/storage';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import CopyableOutput from '../../components/CopyableOutput';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';

export default function DecryptFileScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [decryptFilePayload, setDecryptFilePayload] = useState('');
  const [decryptFileSender, setDecryptFileSender] = useState('');
  const [decryptFileOutput, setDecryptFileOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onDecryptFile = async () => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password',
      submitLabel: 'Decrypt',
    });
    if (password === null) {
      return;
    }
    setBusyMessage('Decrypting file…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = parseEbpPayloadInput(decryptFilePayload);
      const result = await decryptFile({
        identityName,
        password,
        payload,
        sender: decryptFileSender || undefined,
      });
      setDecryptFileOutput(
        `Verify: ${result.verifyStatus}\nName: ${result.fileName}\nType: ${result.mimeType}\nSize: ${result.fileSize}\n\nBase64:\n${result.fileDataBase64}`,
      );
      setStatus('File decrypted');
    } catch (error) {
      setDecryptFileOutput('');
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
        label="Encrypted file payload"
        value={decryptFilePayload}
        onChangeText={setDecryptFilePayload}
        placeholder="Encrypted file payload JSON"
        multiline
      />
      <TextField
        label="Sender"
        value={decryptFileSender}
        onChangeText={setDecryptFileSender}
        placeholder="Sender (for signed payloads)"
      />
      <AppButton
        title={busy ? 'Decrypting…' : 'Decrypt File'}
        onPress={onDecryptFile}
        disabled={busy}
      />
      <CopyableOutput
        value={decryptFileOutput}
        placeholder="Decrypted file info…"
      />
    </Screen>
  );
}
