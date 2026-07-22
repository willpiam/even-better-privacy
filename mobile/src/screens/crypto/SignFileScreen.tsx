import React, {useState} from 'react';
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

export default function SignFileScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [fileUri, setFileUri] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileContext, setFileContext] = useState('');
  const [fileSignOutput, setFileSignOutput] = useState('');
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
      <AppButton title="Pick File" variant="secondary" onPress={pickSignFile} />
      <TextField
        label="Context message"
        value={fileContext}
        onChangeText={setFileContext}
        placeholder="Optional context message"
        multiline
      />
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
