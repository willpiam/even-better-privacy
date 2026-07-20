import React, {useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {CryptoStackParamList} from '../navigation/AppNavigator';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import Share from 'react-native-share';
import {
  signFile,
  signMessage,
  verifyFileSignature,
  verifyMessage,
} from '../services/signVerify';
import {parseEbpPayloadInput} from '../ebpCore';
import {fingerprintFromPublicIdentity} from '../services/identityHelpers';
import {getCurrentIdentityRequired} from '../services/storage';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import BusyOverlay from '../components/BusyOverlay';
import CopyableOutput from '../components/CopyableOutput';
import StatusBanner from '../components/StatusBanner';
import CryptoModeSwitch from '../components/CryptoModeSwitch';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<CryptoStackParamList, 'SignVerify'>;

export default function SignVerifyScreen({navigation}: Props): JSX.Element {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [detached, setDetached] = useState('false');
  const [includeIdentity, setIncludeIdentity] = useState('true');
  const [signOutput, setSignOutput] = useState('');

  const [verifyPayload, setVerifyPayload] = useState('');
  const [verifyMessageText, setVerifyMessageText] = useState('');
  const [verifyOutput, setVerifyOutput] = useState('');
  const [publicIdentityJson, setPublicIdentityJson] = useState('');
  const [computedFingerprint, setComputedFingerprint] = useState('');

  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileContext, setFileContext] = useState('');
  const [fileSignOutput, setFileSignOutput] = useState('');
  const [verifyFileUri, setVerifyFileUri] = useState('');
  const [verifyFilePayload, setVerifyFilePayload] = useState('');
  const [verifyFileOutput, setVerifyFileOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const runSign = async () => {
    setBusyMessage('Signing message...');
    setStatus('');
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
    } finally {
      setBusyMessage(null);
    }
  };

  const onSign = () => {
    Alert.alert('Confirm sign', 'Sign this message with the current identity?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Sign', onPress: () => void runSign()},
    ]);
  };

  const onFingerprintFromPublic = () => {
    try {
      const parsed = JSON.parse(publicIdentityJson) as Record<string, unknown>;
      const fp = fingerprintFromPublicIdentity(parsed);
      setComputedFingerprint(fp);
      setStatus('Fingerprint computed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setComputedFingerprint('');
    }
  };

  const onVerify = async () => {
    setBusyMessage('Verifying signature...');
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

  const onSignFile = async () => {
    setBusyMessage('Signing file...');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const result = await signFile({
        identityName,
        password,
        fileUri,
        fileName: fileName || undefined,
        contextMessage: fileContext || undefined,
        includeSalt: true,
      });
      setFileSignOutput(JSON.stringify(result.payload, null, 2));
      setStatus('File signed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
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
        setFileName(file.name ?? 'picked-file');
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
    setBusyMessage('Verifying file signature...');
    setStatus('');
    try {
      const payload = parseEbpPayloadInput(verifyFilePayload);
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
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <CryptoModeSwitch mode="sign" navigation={navigation} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Identity password"
        value={password}
        onChangeText={setPassword}
        placeholder="Identity password"
        secureTextEntry
      />

      <SectionTitle>Sign Message</SectionTitle>
      <TextField
        label="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="Message"
        multiline
      />
      <TextField
        label="Detached"
        value={detached}
        onChangeText={setDetached}
        placeholder="true or false"
      />
      <TextField
        label="Include identity"
        value={includeIdentity}
        onChangeText={setIncludeIdentity}
        placeholder="true or false"
      />
      <AppButton
        title={busy ? 'Signing...' : 'Sign Message'}
        onPress={onSign}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => shareOutput(signOutput)}
      />
      <CopyableOutput value={signOutput} placeholder="Signed output..." />

      <SectionTitle>Fingerprint from public identity</SectionTitle>
      <TextField
        label="Public identity JSON"
        value={publicIdentityJson}
        onChangeText={setPublicIdentityJson}
        placeholder="Public identity JSON"
        multiline
      />
      <AppButton title="Compute fingerprint" onPress={onFingerprintFromPublic} />
      {computedFingerprint ? (
        <Text style={styles.output}>{computedFingerprint}</Text>
      ) : null}

      <SectionTitle>Verify Message</SectionTitle>
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
        title={busy ? 'Verifying...' : 'Verify Message'}
        onPress={onVerify}
        disabled={busy}
      />
      {verifyOutput ? <Text style={styles.output}>{verifyOutput}</Text> : null}

      <SectionTitle>Sign File</SectionTitle>
      <TextField
        label="File URI"
        value={fileUri}
        onChangeText={setFileUri}
        placeholder="file:///..."
        autoCapitalize="none"
      />
      <TextField
        label="Context message"
        value={fileContext}
        onChangeText={setFileContext}
        placeholder="Optional context message"
        multiline
      />
      <AppButton
        title={busy ? 'Signing...' : 'Sign File'}
        onPress={onSignFile}
        disabled={busy}
      />
      <AppButton title="Pick File" variant="secondary" onPress={pickSignFile} />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => shareOutput(fileSignOutput)}
      />
      <CopyableOutput value={fileSignOutput} placeholder="Signed file payload..." />

      <SectionTitle>Verify File Signature</SectionTitle>
      <TextField
        label="File URI"
        value={verifyFileUri}
        onChangeText={setVerifyFileUri}
        placeholder="file:///..."
        autoCapitalize="none"
      />
      <AppButton title="Pick File" variant="secondary" onPress={pickVerifyFile} />
      <TextField
        label="Signed file payload"
        value={verifyFilePayload}
        onChangeText={setVerifyFilePayload}
        placeholder="Signed file payload JSON"
        multiline
      />
      <AppButton
        title={busy ? 'Verifying...' : 'Verify File Signature'}
        onPress={onVerifyFile}
        disabled={busy}
      />
      <CopyableOutput
        value={verifyFileOutput}
        placeholder="File verification result..."
      />
      <View style={styles.bottomPad} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  output: {
    fontSize: typography.body,
    color: colors.text,
  },
  bottomPad: {height: 16},
});
