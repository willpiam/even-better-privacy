import React, {useState} from 'react';
import {Text} from 'react-native';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import {decryptFile} from '../../services/encryptDecrypt';
import {parseEbpPayloadInput} from '../../ebpCore';
import {getCurrentIdentityRequired} from '../../services/storage';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

type DecryptedFile = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileDataBase64: string;
  verifyStatus: string;
};

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DecryptFileScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [decryptFilePayload, setDecryptFilePayload] = useState('');
  const [decryptFileSender, setDecryptFileSender] = useState('');
  const [decrypted, setDecrypted] = useState<DecryptedFile | null>(null);
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
      setDecrypted({
        fileName: result.fileName,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        fileDataBase64: result.fileDataBase64,
        verifyStatus: result.verifyStatus,
      });
      setStatus('File decrypted');
    } catch (error) {
      setDecrypted(null);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onShareFile = async () => {
    if (!decrypted) {
      return;
    }
    try {
      const safeName = decrypted.fileName.replace(/[/\\]/g, '_') || 'decrypted-file';
      const path = `${RNFS.CachesDirectoryPath}/${safeName}`;
      await RNFS.writeFile(path, decrypted.fileDataBase64, 'base64');
      await Share.open({
        url: `file://${path}`,
        type: decrypted.mimeType || 'application/octet-stream',
        filename: safeName,
        failOnCancel: false,
      });
      setStatus('Shared decrypted file');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const busy = busyMessage !== null;
  const preview =
    decrypted &&
    `Verify: ${decrypted.verifyStatus}\nName: ${decrypted.fileName}\nType: ${decrypted.mimeType}\nSize: ${formatBytes(decrypted.fileSize)}`;

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
      {preview ? (
        <>
          <Text style={cryptoStyles.output} selectable>
            {preview}
          </Text>
          <AppButton title="Share / save file" onPress={onShareFile} />
        </>
      ) : null}
    </Screen>
  );
}
