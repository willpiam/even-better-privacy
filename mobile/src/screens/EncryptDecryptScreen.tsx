import React, {useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {CryptoStackParamList} from '../navigation/AppNavigator';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import Share from 'react-native-share';
import {
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
} from '../services/encryptDecrypt';
import {parseEbpPayloadInput} from '../ebpCore';
import {getCurrentIdentityRequired} from '../services/storage';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import BusyOverlay from '../components/BusyOverlay';
import ContactPicker from '../components/ContactPicker';
import CopyableOutput from '../components/CopyableOutput';
import StatusBanner from '../components/StatusBanner';
import CryptoModeSwitch from '../components/CryptoModeSwitch';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<CryptoStackParamList, 'EncryptDecrypt'>;

export default function EncryptDecryptScreen({navigation}: Props): JSX.Element {
  const [password, setPassword] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sign, setSign] = useState('false');
  const [encryptOutput, setEncryptOutput] = useState('');

  const [decryptPayload, setDecryptPayload] = useState('');
  const [decryptSender, setDecryptSender] = useState('');
  const [decryptOutput, setDecryptOutput] = useState('');

  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileMime, setFileMime] = useState('application/octet-stream');
  const [fileRecipient, setFileRecipient] = useState('');
  const [fileSign, setFileSign] = useState('false');
  const [encryptFileOutput, setEncryptFileOutput] = useState('');

  const [decryptFilePayload, setDecryptFilePayload] = useState('');
  const [decryptFileSender, setDecryptFileSender] = useState('');
  const [decryptFileOutput, setDecryptFileOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const onEncrypt = async () => {
    setBusyMessage('Encrypting message...');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await encryptMessage({
        identityName,
        password: sign === 'true' ? password : undefined,
        message,
        recipient,
        sign: sign === 'true',
      });
      setEncryptOutput(JSON.stringify(payload, null, 2));
      setStatus('Message encrypted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onDecrypt = async () => {
    setBusyMessage('Decrypting message...');
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
      setDecryptOutput(
        `Verify: ${result.verifyStatus}\n\n${result.message}`,
      );
      setStatus('Message decrypted');
    } catch (error) {
      setDecryptOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onEncryptFile = async () => {
    setBusyMessage('Encrypting file...');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await encryptFile({
        identityName,
        password: fileSign === 'true' ? password : undefined,
        fileUri,
        fileName: fileName || 'encrypted.bin',
        mimeType: fileMime || undefined,
        recipient: fileRecipient,
        sign: fileSign === 'true',
      });
      setEncryptFileOutput(JSON.stringify(payload, null, 2));
      setStatus('File encrypted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onDecryptFile = async () => {
    setBusyMessage('Decrypting file...');
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

  const pickEncryptFile = async () => {
    try {
      const [file] = await pick({
        mode: 'open',
      });
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

  const shareOutput = async (value: string) => {
    if (!value) {
      return;
    }
    await Share.open({message: value, failOnCancel: false});
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <CryptoModeSwitch mode="encrypt" navigation={navigation} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Identity password"
        value={password}
        onChangeText={setPassword}
        placeholder="Identity password"
        secureTextEntry
      />

      <SectionTitle>Encrypt Message</SectionTitle>
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
      <TextField
        label="Sign"
        value={sign}
        onChangeText={setSign}
        placeholder="true or false"
      />
      <AppButton
        title={busy ? 'Encrypting...' : 'Encrypt Message'}
        onPress={onEncrypt}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => shareOutput(encryptOutput)}
      />
      <CopyableOutput
        value={encryptOutput}
        placeholder="Encrypted message payload..."
      />

      <SectionTitle>Decrypt Message</SectionTitle>
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
        title={busy ? 'Decrypting...' : 'Decrypt Message'}
        onPress={onDecrypt}
        disabled={busy}
      />
      <TextField
        label="Decrypted output"
        value={decryptOutput}
        editable={false}
        multiline
      />

      <SectionTitle>Encrypt File</SectionTitle>
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
      <TextField
        label="Sign"
        value={fileSign}
        onChangeText={setFileSign}
        placeholder="true or false"
      />
      <AppButton
        title={busy ? 'Encrypting...' : 'Encrypt File'}
        onPress={onEncryptFile}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => shareOutput(encryptFileOutput)}
      />
      <CopyableOutput
        value={encryptFileOutput}
        placeholder="Encrypted file payload..."
      />

      <SectionTitle>Decrypt File</SectionTitle>
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
        title={busy ? 'Decrypting...' : 'Decrypt File'}
        onPress={onDecryptFile}
        disabled={busy}
      />
      <CopyableOutput
        value={decryptFileOutput}
        placeholder="Decrypted file info..."
      />
    </Screen>
  );
}
