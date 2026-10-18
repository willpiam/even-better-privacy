import React, {useState} from 'react';
import {Switch, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import {verifyMessage} from '../../services/signVerify';
import {parseEbpPayloadInput, type ExternalIdentity} from '../../ebpCore';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

function parsePublicIdentityJson(raw: string): ExternalIdentity {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Public keys must be a JSON object');
  }
  if (typeof parsed.signingKey !== 'string' || !parsed.signingKey) {
    throw new Error('public identity missing signing key');
  }
  if (typeof parsed.signingKeyType !== 'string' || !parsed.signingKeyType) {
    throw new Error('public identity missing signing key type');
  }
  return parsed as unknown as ExternalIdentity;
}

export default function VerifyMessageScreen(): JSX.Element {
  const [verifyPayload, setVerifyPayload] = useState('');
  const [verifyMessageText, setVerifyMessageText] = useState('');
  const [usePublicKeys, setUsePublicKeys] = useState(false);
  const [publicKeysJson, setPublicKeysJson] = useState('');
  const [verifyOutput, setVerifyOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const pastePublicKeys = () => {
    void Clipboard.getString().then(text => {
      if (text.trim()) {
        setPublicKeysJson(text);
        setStatus('Pasted public keys');
      } else {
        setStatus('Clipboard is empty');
      }
    });
  };

  const importPublicKeysFile = async () => {
    try {
      const [file] = await pick({mode: 'open'});
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'public-keys.json'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status !== 'success') {
        throw new Error(copyResult.copyError);
      }
      const path = copyResult.localUri.startsWith('file://')
        ? copyResult.localUri.replace('file://', '')
        : copyResult.localUri;
      const contents = await RNFS.readFile(path, 'utf8');
      setPublicKeysJson(contents);
      setStatus('Imported public keys file');
    } catch {
      // User cancelled picker.
    }
  };

  const onVerify = async () => {
    setBusyMessage('Verifying signature…');
    setStatus('');
    try {
      const payload = parseEbpPayloadInput(verifyPayload);
      let publicIdentity: ExternalIdentity | undefined;
      if (usePublicKeys) {
        if (!publicKeysJson.trim()) {
          throw new Error('Public keys JSON is required');
        }
        publicIdentity = parsePublicIdentityJson(publicKeysJson);
      }
      const result = await verifyMessage({
        payload,
        message: verifyMessageText || undefined,
        publicIdentity,
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

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Signed payload"
        testID="verify-payload-input"
        value={verifyPayload}
        onChangeText={setVerifyPayload}
        placeholder="Signed payload JSON"
        multiline
      />
      <AppButton
        title="Paste from clipboard"
        testID="verify-paste-clipboard"
        variant="secondary"
        onPress={() => {
          void Clipboard.getString().then(text => {
            if (text.trim()) {
              setVerifyPayload(text);
              setStatus('Pasted payload');
            } else {
              setStatus('Clipboard is empty');
            }
          });
        }}
      />
      <TextField
        label="Detached message"
        value={verifyMessageText}
        onChangeText={setVerifyMessageText}
        placeholder="Detached message (if needed)"
        multiline
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>
          Provide public keys for verification
        </Text>
        <Switch
          testID="verify-use-public-keys"
          value={usePublicKeys}
          onValueChange={setUsePublicKeys}
        />
      </View>
      {usePublicKeys ? (
        <>
          <TextField
            label="Public keys JSON"
            testID="verify-public-keys"
            value={publicKeysJson}
            onChangeText={setPublicKeysJson}
            placeholder='{"fingerprint":"...","signingKey":"...","signingKeyType":"..."}'
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={cryptoStyles.signActions}>
            <AppButton
              title="Paste"
              testID="verify-public-keys-paste"
              variant="secondary"
              onPress={pastePublicKeys}
              style={cryptoStyles.flexBtn}
            />
            <AppButton
              title="Import public keys file"
              variant="secondary"
              onPress={importPublicKeysFile}
              style={cryptoStyles.flexBtn}
            />
          </View>
        </>
      ) : null}
      <AppButton
        title={busy ? 'Verifying…' : 'Verify Message'}
        testID="verify-submit"
        onPress={onVerify}
        disabled={busy}
      />
      {verifyOutput ? (
        <Text testID="verify-result" style={cryptoStyles.output}>
          {verifyOutput}
        </Text>
      ) : null}
    </Screen>
  );
}
