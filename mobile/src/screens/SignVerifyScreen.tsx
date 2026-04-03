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
  signFile,
  signMessage,
  verifyFileSignature,
  verifyMessage,
} from '../services/signVerify';
import {getCurrentIdentityRequired} from '../services/storage';
import CopyableOutput from '../components/CopyableOutput';
import StatusBanner from '../components/StatusBanner';

export default function SignVerifyScreen(): JSX.Element {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [detached, setDetached] = useState('false');
  const [includeIdentity, setIncludeIdentity] = useState('true');
  const [signOutput, setSignOutput] = useState('');

  const [verifyPayload, setVerifyPayload] = useState('');
  const [verifyMessageText, setVerifyMessageText] = useState('');
  const [verifyOutput, setVerifyOutput] = useState('');

  const [fileUri, setFileUri] = useState('');
  const [fileContext, setFileContext] = useState('');
  const [fileSignOutput, setFileSignOutput] = useState('');
  const [verifyFileUri, setVerifyFileUri] = useState('');
  const [verifyFilePayload, setVerifyFilePayload] = useState('');
  const [verifyFileOutput, setVerifyFileOutput] = useState('');
  const [status, setStatus] = useState('');

  const onSign = async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await signMessage({
        identityName,
        password,
        message,
        options: {
          detached: detached === 'true',
          includeIdentity: includeIdentity === 'true',
        },
      });
      setSignOutput(JSON.stringify(payload, null, 2));
      setStatus('Message signed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onVerify = async () => {
    try {
      const payload = JSON.parse(verifyPayload) as Record<string, unknown>;
      const result = await verifyMessage({
        payload,
        message: verifyMessageText || undefined,
      });
      setVerifyOutput(result.verified ? 'Valid signature' : 'Invalid signature');
      setStatus('Verification complete');
    } catch (error) {
      setVerifyOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onSignFile = async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
      const result = await signFile({
        identityName,
        password,
        fileUri,
        contextMessage: fileContext || undefined,
        includeSalt: true,
      });
      setFileSignOutput(JSON.stringify(result.payload, null, 2));
      setStatus('File signed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const pickSignFile = async () => {
    try {
      const [file] = await pick({
        mode: 'open',
      });
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'picked-file'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status === 'success') {
        setFileUri(copyResult.localUri);
      } else {
        throw new Error(copyResult.copyError);
      }
    } catch {
      // User cancelled picker.
    }
  };

  const pickVerifyFile = async () => {
    try {
      const [file] = await pick({
        mode: 'open',
      });
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'picked-file'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status === 'success') {
        setVerifyFileUri(copyResult.localUri);
      } else {
        throw new Error(copyResult.copyError);
      }
    } catch {
      // User cancelled picker.
    }
  };

  const shareOutput = async (value: string) => {
    if (!value) {
      return;
    }
    await Share.open({
      message: value,
      failOnCancel: false,
    });
  };

  const onVerifyFile = async () => {
    try {
      const payload = JSON.parse(verifyFilePayload) as Record<string, unknown>;
      const result = await verifyFileSignature({
        fileUri: verifyFileUri,
        payload,
      });
      setVerifyFileOutput(
        `${result.verified ? 'Valid' : 'Invalid'}\n\n${result.details}\n\n${result.signedMessage}`,
      );
      setStatus('File verification complete');
    } catch (error) {
      setVerifyFileOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>Sign / Verify</Text>
        <StatusBanner message={status} kind={status.toLowerCase().includes('failed') ? 'error' : 'info'} />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Identity password"
          secureTextEntry
        />

        <Text style={styles.section}>Sign Message</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={message}
          onChangeText={setMessage}
          placeholder="Message"
          multiline
        />
        <TextInput
          style={styles.input}
          value={detached}
          onChangeText={setDetached}
          placeholder="Detached: true or false"
        />
        <TextInput
          style={styles.input}
          value={includeIdentity}
          onChangeText={setIncludeIdentity}
          placeholder="Include identity: true or false"
        />
        <Button title="Sign Message" onPress={onSign} />
        <Button title="Share Output" onPress={() => shareOutput(signOutput)} />
        <CopyableOutput value={signOutput} placeholder="Signed output..." />

        <Text style={styles.section}>Verify Message</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={verifyPayload}
          onChangeText={setVerifyPayload}
          placeholder="Signed payload JSON"
          multiline
        />
        <TextInput
          style={[styles.input, styles.multi]}
          value={verifyMessageText}
          onChangeText={setVerifyMessageText}
          placeholder="Detached message (if needed)"
          multiline
        />
        <Button title="Verify Message" onPress={onVerify} />
        <Text style={styles.output}>{verifyOutput}</Text>

        <Text style={styles.section}>Sign File</Text>
        <TextInput
          style={styles.input}
          value={fileUri}
          onChangeText={setFileUri}
          placeholder="File URI (file:///...)"
        />
        <TextInput
          style={[styles.input, styles.multi]}
          value={fileContext}
          onChangeText={setFileContext}
          placeholder="Optional context message"
          multiline
        />
        <Button title="Sign File" onPress={onSignFile} />
        <Button title="Pick File" onPress={pickSignFile} />
        <Button title="Share Output" onPress={() => shareOutput(fileSignOutput)} />
        <CopyableOutput value={fileSignOutput} placeholder="Signed file payload..." />

        <Text style={styles.section}>Verify File Signature</Text>
        <TextInput
          style={styles.input}
          value={verifyFileUri}
          onChangeText={setVerifyFileUri}
          placeholder="File URI (file:///...)"
        />
        <Button title="Pick File" onPress={pickVerifyFile} />
        <TextInput
          style={[styles.input, styles.multi]}
          value={verifyFilePayload}
          onChangeText={setVerifyFilePayload}
          placeholder="Signed file payload JSON"
          multiline
        />
        <Button title="Verify File Signature" onPress={onVerifyFile} />
        <CopyableOutput value={verifyFileOutput} placeholder="File verification result..." />
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
  output: {marginTop: 8, marginBottom: 8, color: '#111'},
});
