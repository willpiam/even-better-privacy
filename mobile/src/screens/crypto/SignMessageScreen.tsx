import React, {useState} from 'react';
import {Alert, Switch, Text, View} from 'react-native';
import Share from 'react-native-share';
import {signMessage} from '../../services/signVerify';
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

export default function SignMessageScreen(): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [message, setMessage] = useState('');
  const [detached, setDetached] = useState(false);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [signOutput, setSignOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const runSign = async (password: string) => {
    setBusyMessage('Signing message…');
    setStatus('');
    try {
      const identityName = await getCurrentIdentityRequired();
      const payload = await signMessage({
        identityName,
        password,
        message,
        options: {detached, includeIdentity},
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
      {
        text: 'Sign',
        onPress: () => {
          void (async () => {
            const password = await promptSecret({
              title: 'Identity password',
              placeholder: 'Identity password',
              submitLabel: 'Sign',
            });
            if (password === null) {
              return;
            }
            await runSign(password);
          })();
        },
      },
    ]);
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="Message"
        multiline
      />
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Detached signature</Text>
        <Switch value={detached} onValueChange={setDetached} />
      </View>
      <View style={cryptoStyles.switchRow}>
        <Text style={cryptoStyles.switchLabel}>Include identity</Text>
        <Switch value={includeIdentity} onValueChange={setIncludeIdentity} />
      </View>
      <AppButton
        title={busy ? 'Signing…' : 'Sign Message'}
        onPress={onSign}
        disabled={busy}
      />
      <AppButton
        title="Share Output"
        variant="secondary"
        onPress={() => {
          if (signOutput) {
            void Share.open({message: signOutput, failOnCancel: false});
          }
        }}
      />
      <CopyableOutput value={signOutput} placeholder="Signed output…" />
    </Screen>
  );
}
