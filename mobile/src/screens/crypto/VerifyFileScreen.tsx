import React, {useState} from 'react';
import {Text} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import {verifyFileSignature} from '../../services/signVerify';
import {parseEbpPayloadInput} from '../../ebpCore';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import CopyableOutput from '../../components/CopyableOutput';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function VerifyFileScreen(): JSX.Element {
  const [verifyFileUri, setVerifyFileUri] = useState('');
  const [verifyFileName, setVerifyFileName] = useState('');
  const [verifyFilePayload, setVerifyFilePayload] = useState('');
  const [verifyFileOutput, setVerifyFileOutput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const pickVerifyFile = async () => {
    try {
      const [file] = await pick({mode: 'open'});
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'picked-file'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status === 'success') {
        setVerifyFileUri(copyResult.localUri);
        setVerifyFileName(file.name ?? 'picked-file');
      } else {
        throw new Error(copyResult.copyError);
      }
    } catch {
      // User cancelled picker.
    }
  };

  const onVerifyFile = async () => {
    setBusyMessage('Verifying file signature…');
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
      <StatusBanner message={status} kind={statusKind(status)} />
      <AppButton title="Pick File" onPress={pickVerifyFile} />
      {verifyFileName ? (
        <Text style={cryptoStyles.helpText} testID="verify-file-name">
          Selected: {verifyFileName}
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
        <TextField
          label="File URI (advanced)"
          value={verifyFileUri}
          onChangeText={setVerifyFileUri}
          placeholder="file:///..."
          autoCapitalize="none"
        />
      ) : null}
      <TextField
        label="Signed file payload"
        value={verifyFilePayload}
        onChangeText={setVerifyFilePayload}
        placeholder="Signed file payload JSON"
        multiline
      />
      <AppButton
        title={busy ? 'Verifying…' : 'Verify File Signature'}
        onPress={onVerifyFile}
        disabled={busy}
      />
      <CopyableOutput
        value={verifyFileOutput}
        placeholder="File verification result…"
      />
    </Screen>
  );
}
