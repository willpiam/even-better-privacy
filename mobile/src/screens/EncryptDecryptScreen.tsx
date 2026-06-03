import React, {useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
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
import ContactPicker from '../components/ContactPicker';
import CopyableOutput from '../components/CopyableOutput';
import StatusBanner from '../components/StatusBanner';

export default function EncryptDecryptScreen(): JSX.Element {
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

  const onEncrypt = async () => {
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
    }
  };

  const onDecrypt = async () => {
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
    }
  };

  const onEncryptFile = async () => {
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
    }
  };

  const onDecryptFile = async () => {
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>Encrypt / Decrypt</Text>
        <StatusBanner message={status} kind={status.toLowerCase().includes('failed') ? 'error' : 'info'} />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Identity password"
          secureTextEntry
        />

        <Text style={styles.section}>Encrypt Message</Text>
        <ContactPicker
          value={recipient}
          onChange={setRecipient}
          placeholder="Recipient (name or fingerprint)"
        />
        <TextInput
          style={[styles.input, styles.multi]}
          value={message}
          onChangeText={setMessage}
          placeholder="Message"
          multiline
        />
        <TextInput
          style={styles.input}
          value={sign}
          onChangeText={setSign}
          placeholder="Sign: true or false"
        />
        <Button title="Encrypt Message" onPress={onEncrypt} />
        <Button title="Share Output" onPress={() => shareOutput(encryptOutput)} />
        <CopyableOutput value={encryptOutput} placeholder="Encrypted message payload..." />

        <Text style={styles.section}>Decrypt Message</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={decryptPayload}
          onChangeText={setDecryptPayload}
          placeholder="Encrypted payload JSON"
          multiline
        />
        <TextInput
          style={styles.input}
          value={decryptSender}
          onChangeText={setDecryptSender}
          placeholder="Sender (for signed payloads)"
        />
        <Button title="Decrypt Message" onPress={onDecrypt} />
        <TextInput style={[styles.input, styles.multi]} value={decryptOutput} editable={false} multiline />

        <Text style={styles.section}>Encrypt File</Text>
        <TextInput
          style={styles.input}
          value={fileUri}
          onChangeText={setFileUri}
          placeholder="File URI (file:///...)"
        />
        <Button title="Pick File" onPress={pickEncryptFile} />
        <TextInput
          style={styles.input}
          value={fileName}
          onChangeText={setFileName}
          placeholder="File name"
        />
        <TextInput
          style={styles.input}
          value={fileMime}
          onChangeText={setFileMime}
          placeholder="MIME type"
        />
        <ContactPicker
          value={fileRecipient}
          onChange={setFileRecipient}
          placeholder="Recipient (name or fingerprint)"
        />
        <TextInput
          style={styles.input}
          value={fileSign}
          onChangeText={setFileSign}
          placeholder="Sign: true or false"
        />
        <Button title="Encrypt File" onPress={onEncryptFile} />
        <Button title="Share Output" onPress={() => shareOutput(encryptFileOutput)} />
        <CopyableOutput value={encryptFileOutput} placeholder="Encrypted file payload..." />

        <Text style={styles.section}>Decrypt File</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={decryptFilePayload}
          onChangeText={setDecryptFilePayload}
          placeholder="Encrypted file payload JSON"
          multiline
        />
        <TextInput
          style={styles.input}
          value={decryptFileSender}
          onChangeText={setDecryptFileSender}
          placeholder="Sender (for signed payloads)"
        />
        <Button title="Decrypt File" onPress={onDecryptFile} />
        <CopyableOutput value={decryptFileOutput} placeholder="Decrypted file info..." />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff', padding: 16},
  header: {fontWeight: '700', fontSize: 20, marginBottom: 8, color: '#111'},
  section: {marginTop: 12, marginBottom: 6, fontWeight: '700', color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    color: '#111',
  },
  multi: {minHeight: 90, textAlignVertical: 'top'},
});
