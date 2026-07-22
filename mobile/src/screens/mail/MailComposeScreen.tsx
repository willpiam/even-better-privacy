import React, {useCallback, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import ContactPicker from '../../components/ContactPicker';
import RecipientResolveModal from '../../components/RecipientResolveModal';
import StatusBanner from '../../components/StatusBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import SectionTitle from '../../components/SectionTitle';
import {
  findContactsByEmail,
  type StoredContact,
} from '../../services/contacts';
import {getCurrentIdentityRequired} from '../../services/storage';
import {sendEbpMail, sendPlainMail} from '../../services/mail/ebpMail';
import {appendActivityLog} from '../../services/activityLog';
import {statusKind} from '../../theme/statusKind';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailCompose'>;

type EncryptionIntent = 'pending' | 'encrypted' | 'unencrypted';

function looksLikeEmail(value: string): boolean {
  return value.trim().includes('@');
}

function initialIntent(
  params: Props['route']['params'],
): EncryptionIntent {
  if (params?.encryptionIntent === 'encrypted' || params?.recipientContact) {
    return 'encrypted';
  }
  if (params?.encryptionIntent === 'unencrypted') {
    return 'unencrypted';
  }
  return 'pending';
}

export default function MailComposeScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const params = route.params;
  const [to, setTo] = useState(params?.to ?? '');
  const [subject, setSubject] = useState(params?.subject ?? '');
  const [message, setMessage] = useState(params?.message ?? '');
  const [recipientContact, setRecipientContact] = useState(
    params?.recipientContact ?? '',
  );
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [encryptionIntent, setEncryptionIntent] = useState<EncryptionIntent>(
    () => initialIntent(params),
  );
  const [resolveModalVisible, setResolveModalVisible] = useState(false);
  const [preferredContacts, setPreferredContacts] = useState<StoredContact[]>(
    [],
  );
  const inReplyTo = params?.inReplyTo;
  const references = params?.references;

  const applyEncryptedContact = useCallback((name: string) => {
    setRecipientContact(name);
    setEncryptionIntent('encrypted');
    setResolveModalVisible(false);
    setPreferredContacts([]);
    setStatus('');
  }, []);

  const applyUnencrypted = useCallback(() => {
    setRecipientContact('');
    setEncryptionIntent('unencrypted');
    setResolveModalVisible(false);
    setPreferredContacts([]);
    setStatus('');
  }, []);

  const onToChange = (next: string) => {
    setTo(next);
    setEncryptionIntent('pending');
    setRecipientContact('');
    setPreferredContacts([]);
    setResolveModalVisible(false);
  };

  const onRecipientContactChange = (name: string) => {
    setRecipientContact(name);
    if (name.trim()) {
      setEncryptionIntent('encrypted');
    } else if (encryptionIntent === 'encrypted') {
      setEncryptionIntent('pending');
    }
  };

  const resolveRecipientFromTo = async () => {
    const address = to.trim();
    if (!looksLikeEmail(address)) {
      return;
    }
    try {
      const matches = await findContactsByEmail(address);
      if (matches.length === 1) {
        applyEncryptedContact(matches[0].name);
        return;
      }
      setPreferredContacts(matches);
      setRecipientContact('');
      setEncryptionIntent('pending');
      setResolveModalVisible(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onSend = async () => {
    try {
      if (encryptionIntent === 'pending') {
        setStatus('Resolve recipient encryption first');
        return;
      }
      const identityName = await getCurrentIdentityRequired();
      if (encryptionIntent === 'unencrypted') {
        await sendPlainMail({
          identityName,
          to,
          subject,
          message,
          inReplyTo,
          references,
        });
        await appendActivityLog(`Sent unencrypted mail to ${to}`, 'success');
        setStatus('Unencrypted message sent');
        navigation.goBack();
        return;
      }
      if (!recipientContact.trim()) {
        setStatus('Select an EBP contact to encrypt for');
        return;
      }
      await sendEbpMail({
        identityName,
        password,
        to,
        subject,
        message,
        recipientContact,
        sign: true,
        inReplyTo,
        references,
      });
      await appendActivityLog(`Sent EBP mail to ${to}`, 'success');
      setStatus('EBP message sent');
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const showUnencryptedWarning = encryptionIntent === 'unencrypted';

  return (
    <Screen scroll>
      <Text style={styles.note}>
        Compose an email. After you enter a To address, the app checks your
        contacts for a matching email or opaque email detail.
      </Text>

      {showUnencryptedWarning ? (
        <StatusBanner
          kind="error"
          message="This message will not be encrypted because an EBP recipient identity could not be found nor was specified."
        />
      ) : null}

      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Message</SectionTitle>
      <TextField
        label="To"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={to}
        onChangeText={onToChange}
        onBlur={() => {
          void resolveRecipientFromTo();
        }}
        placeholder="recipient@example.com"
        accessibilityLabel="To email address"
      />
      <TextField
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        placeholder="Subject"
        accessibilityLabel="Subject"
      />
      <TextField
        label="Body"
        value={message}
        onChangeText={setMessage}
        placeholder="Write your message..."
        multiline
        accessibilityLabel="Message body"
        style={styles.bodyField}
      />

      <SectionTitle>EBP encryption</SectionTitle>
      {encryptionIntent === 'encrypted' ? (
        <>
          <ContactPicker
            variant="dropdown"
            value={recipientContact}
            onChange={onRecipientContactChange}
            placeholder="Select EBP contact"
          />
          <Text style={styles.hint}>
            The message body is encrypted for the selected contact.
          </Text>
          <TextField
            label="Identity password"
            value={password}
            onChangeText={setPassword}
            placeholder="Password for your current identity"
            secureTextEntry
            accessibilityLabel="Identity password"
          />
          <AppButton title="Send EBP encrypted mail" onPress={onSend} />
        </>
      ) : encryptionIntent === 'unencrypted' ? (
        <>
          <Text style={styles.hint}>
            Sending as plaintext. Change the To address to re-check contacts, or
            pick an EBP contact below to encrypt.
          </Text>
          <ContactPicker
            variant="dropdown"
            value={recipientContact}
            onChange={onRecipientContactChange}
            placeholder="Select EBP contact to encrypt instead"
          />
          <AppButton title="Send unencrypted mail" onPress={onSend} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Enter a To address and leave the field to resolve encryption, or
            pick an EBP contact manually.
          </Text>
          <ContactPicker
            variant="dropdown"
            value={recipientContact}
            onChange={onRecipientContactChange}
            placeholder="Select EBP contact"
          />
          <AppButton title="Send" onPress={onSend} />
        </>
      )}

      <RecipientResolveModal
        visible={resolveModalVisible}
        email={to.trim()}
        preferredContacts={preferredContacts}
        onCancel={() => setResolveModalVisible(false)}
        onSelectContact={applyEncryptedContact}
        onMarkUnencrypted={applyUnencrypted}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    color: colors.muted,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.muted,
  },
  bodyField: {
    minHeight: 120,
  },
});
