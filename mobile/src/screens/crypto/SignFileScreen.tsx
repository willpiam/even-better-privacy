import React, {useState} from 'react';
import {Switch, Text, View} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import Share from 'react-native-share';
import {signFile} from '../../services/signVerify';
import {getCurrentIdentityRequired} from '../../services/storage';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import CopyableOutput from '../../components/CopyableOutput';
import StatusBanner from '../../components/StatusBanner';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function SignFileScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileContext, setFileContext] = useState('');
  const [includeSalt, setIncludeSalt] = useState(true);
  const [generatedSalt, setGeneratedSalt] = useState('');
  const [fileSignOutput, setFileSignOutput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const pickSignFile = async () => {
    try {
      const [file] = await pick({mode: 'open'});
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

  const onSignFile = async () => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password',
      submitLabel: 'Sign',
    });
    if (password === null) {
      return;
    }
    setBusyMessage('Signing file…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const result = await signFile({
        identityName,
        password,
        fileUri,
        fileName: fileName || undefined,
        contextMessage: fileContext || undefined,
        includeSalt,
      });
      setGeneratedSalt(result.salt);
      setFileSignOutput(JSON.stringify(result.payload, null, 2));
      setStatus('File signed');
    } catch (error) {
      setGeneratedSalt('');
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
      <AppButton title="Pick File" onPress={pickSignFile} />
      {fileName ? (
        <Text style={cryptoStyles.helpText} testID="sign-file-name">
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
        <TextField
          label="File URI (advanced)"
          value={fileUri}
          onChangeText={setFileUri}
          placeholder="file:///..."
          autoCapitalize="none"
        />
      ) : null}
      <TextField
        label="Context message"
        value={fileContext}
        onChangeText={setFileContext}
        placeholder="Optional context message"
        multiline
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Include random salt</Text>
        <Switch
          testID="sign-file-include-salt"
          value={includeSalt}
          onValueChange={setIncludeSalt}
        />
      </View>
      <Text style={cryptoStyles.helpText}>
        Signed message format: ebp::filehash::&lt;hash&gt;::&lt;optional
        salt&gt;::&lt;optional context&gt;
      </Text>
      {fileSignOutput ? (
        <TextField
          label="Generated salt"
          testID="sign-file-salt"
          value={generatedSalt}
          editable={false}
          placeholder="(none — salt disabled)"
        />
      ) : null}
      <AppButton
        title={busy ? 'Signing…' : 'Sign File'}
        onPress={onSignFile}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        disabled={!fileSignOutput}
        onPress={() => {
          void Share.open({message: fileSignOutput, failOnCancel: false});
        }}
      />
      <CopyableOutput value={fileSignOutput} placeholder="Signed file payload…" />
    </Screen>
  );
}
