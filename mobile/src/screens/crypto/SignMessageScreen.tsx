import React, {useState} from 'react';
import {Alert, Switch, Text, View} from 'react-native';
import Share from 'react-native-share';
import Clipboard from '@react-native-clipboard/clipboard';
import {signMessage} from '../../services/signVerify';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import BusyOverlay from '../../components/BusyOverlay';
import CopyableOutput from '../../components/CopyableOutput';
import StatusBanner from '../../components/StatusBanner';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {statusKind} from '../../theme/statusKind';
import {cryptoStyles} from './cryptoStyles';

export default function SignMessageScreen(): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [message, setMessage] = useState('');
  const [detached, setDetached] = useState(false);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [includeSalt, setIncludeSalt] = useState(true);
  const [signOutput, setSignOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const runSign = async (identityName: string) => {
    setBusyMessage('Signing message…');
    setStatus('');
    try {
      const payload = await signMessage({
        identityName,
        message,
        options: {detached, includeIdentity, includeSalt},
      });
      const serialized = JSON.stringify(payload, null, 2);
      Clipboard.setString(serialized);
      setSignOutput(serialized);
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
      {
        text: 'Sign',
        onPress: () => {
          void (async () => {
            try {
              const identityName = await ensureUnlocked();
              if (!identityName) {
                return;
              }
              await runSign(identityName);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          })();
        },
      },
    ]);
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      {unlockPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Message"
        testID="sign-message-input"
        value={message}
        onChangeText={setMessage}
        placeholder="Message"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Detached signature</Text>
        <Switch
          testID="sign-detached"
          value={detached}
          onValueChange={setDetached}
        />
      </View>
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Include identity</Text>
        <Switch
          testID="sign-include-identity"
          value={includeIdentity}
          onValueChange={setIncludeIdentity}
        />
      </View>
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Include random salt</Text>
        <Switch
          testID="sign-include-salt"
          value={includeSalt}
          onValueChange={setIncludeSalt}
        />
      </View>
      <Text style={cryptoStyles.helpText}>
        Signs ebp::messagehash::&lt;sha256&gt;::&lt;optional salt&gt; rather than
        the raw message body.
      </Text>
      <View style={cryptoStyles.signActions}>
        <AppButton
          title={busy ? 'Signing…' : 'Sign Message'}
          testID="sign-message-submit"
          onPress={onSign}
          disabled={busy}
          style={cryptoStyles.flexBtn}
        />
        <AppButton
          title="Copy"
          testID="sign-message-output-copy"
          variant="secondary"
          disabled={!signOutput}
          onPress={() => {
            if (signOutput) {
              Clipboard.setString(signOutput);
            }
          }}
          style={cryptoStyles.flexBtn}
        />
      </View>
      <AppButton
        title="Share Output"
        variant="secondary"
        disabled={!signOutput}
        onPress={() => {
          void Share.open({message: signOutput, failOnCancel: false});
        }}
      />
      <CopyableOutput
        testID="sign-message-output"
        value={signOutput}
        placeholder="Signed output…"
        showCopyButton={false}
      />
    </Screen>
  );
}
