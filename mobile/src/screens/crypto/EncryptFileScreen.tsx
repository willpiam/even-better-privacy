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
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function EncryptFileScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileMime, setFileMime] = useState('application/octet-stream');
  const [fileRecipient, setFileRecipient] = useState('');
  const [fileSign, setFileSign] = useState(false);
  const [encryptFileOutput, setEncryptFileOutput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      if (fileSign) {
        const unlocked = await ensureUnlocked(identityName);
        if (!unlocked) {
          return;
        }
      }
      setBusyMessage('Encrypting file…');
      const payload = await encryptFile({
        identityName,
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
      {unlockPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <AppButton title="Pick File" onPress={pickEncryptFile} />
      {fileName ? (
        <Text style={cryptoStyles.helpText} testID="encrypt-file-name">
          Selected: {fileName}
        </Text>
      ) : (
        <Text style={cryptoStyles.helpText}>No file selected.</Text>
      )}
      <AppButton
        title={showAdvanced ? 'Hide advanced' : 'Show advanced'}
        variant="secondary"
        onPress={() => setShowAdvanced(value => !value)}
      />
      {showAdvanced ? (
        <>
          <TextField
            label="File URI (advanced)"
            value={fileUri}
            onChangeText={setFileUri}
            placeholder="file:///..."
            autoCapitalize="none"
          />
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
        </>
      ) : null}
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
