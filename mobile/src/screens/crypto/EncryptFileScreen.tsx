import React, {useState} from 'react';
import {Switch, Text, View} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import Share from 'react-native-share';
import {encryptFile} from '../../services/encryptDecrypt';
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

export default function EncryptFileScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileMime, setFileMime] = useState('application/octet-stream');
  const [fileRecipient, setFileRecipient] = useState('');
  const [fileSign, setFileSign] = useState(false);
  const [encryptFileOutput, setEncryptFileOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const pickEncryptFile = async () => {
    try {
      const [file] = await pick({mode: 'open'});
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'picked-file'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status !== 'success') {
        throw new Error(copyResult.copyError);
      }
      setFileUri(copyResult.localUri);
      setFileName(file.name ?? 'encrypted.bin');
      setFileMime(file.type ?? 'application/octet-stream');
    } catch {
      // User cancelled picker.
    }
  };

  const onEncryptFile = async () => {
    let password: string | undefined;
    if (fileSign) {
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
    setBusyMessage('Encrypting file…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await encryptFile({
        identityName,
        password,
        fileUri,
        fileName: fileName || 'encrypted.bin',
        mimeType: fileMime || undefined,
        recipient: fileRecipient,
        sign: fileSign,
      });
      setEncryptFileOutput(JSON.stringify(payload, null, 2));
      setStatus('File encrypted');
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
      <TextField
        label="File URI"
        value={fileUri}
        onChangeText={setFileUri}
        placeholder="file:///..."
        autoCapitalize="none"
      />
      <AppButton title="Pick File" variant="secondary" onPress={pickEncryptFile} />
      <TextField
        label="File name"
        value={fileName}
        onChangeText={setFileName}
        placeholder="File name"
      />
      <TextField
        label="MIME type"
        value={fileMime}
        onChangeText={setFileMime}
        placeholder="MIME type"
        autoCapitalize="none"
      />
      <ContactPicker
        value={fileRecipient}
        onChange={setFileRecipient}
        placeholder="Recipient (name or fingerprint)"
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Sign with identity</Text>
        <Switch value={fileSign} onValueChange={setFileSign} />
      </View>
      <AppButton
        title={busy ? 'Encrypting…' : 'Encrypt File'}
        onPress={onEncryptFile}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        disabled={!encryptFileOutput}
        onPress={() => {
          void Share.open({message: encryptFileOutput, failOnCancel: false});
        }}
      />
      <CopyableOutput
        value={encryptFileOutput}
        placeholder="Encrypted file payload…"
      />
    </Screen>
  );
}
