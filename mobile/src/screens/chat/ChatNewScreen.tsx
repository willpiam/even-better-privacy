import React, {useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {chatPeerAllowed} from '../../../../common/ChatChannel';
import type {ChatStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {resolveVerifiedRecipient} from '../../services/contacts';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatNew'>;

function normalizeEmail(value: string): string {
  const trimmed = value.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle?.[1] ?? trimmed).trim().toLowerCase();
}

export default function ChatNewScreen({navigation}: Props): JSX.Element {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    const email = normalizeEmail(address);
    setBusy(true);
    setError(null);
    try {
      const identityName = await getCurrentIdentityRequired();
      const resolved = await resolveSelectedAccount(identityName);
      if (!resolved) {
        throw new Error('Configure a mail account first');
      }
      const own =
        resolved.account.config.fromEmail || resolved.account.config.username;
      if (!chatPeerAllowed(own, email)) {
        throw new Error('Use an address on your mail domain.');
      }
      const match = await resolveVerifiedRecipient(email);
      if (match.status !== 'unique') {
        throw new Error(
          match.status === 'ambiguous'
            ? 'More than one verified identity publishes this address.'
            : 'No verified identity for that address.',
        );
      }
      navigation.replace('ChatThread', {peer: email, contactName: match.name});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      {error ? <StatusBanner message={error} kind="error" /> : null}
      <TextField
        label="Address"
        testID="chat-new-address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={address}
        onChangeText={setAddress}
        placeholder="name@your-domain"
      />
      <AppButton
        title="Start"
        testID="chat-new-start"
        loading={busy}
        disabled={!address.trim()}
        onPress={() => {
          void start();
        }}
      />
    </Screen>
  );
}
