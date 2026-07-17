import React, {useCallback, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
import ContactPicker from '../../components/ContactPicker';
import RecipientResolveModal from '../../components/RecipientResolveModal';
import StatusBanner from '../../components/StatusBanner';
import {
  findContactsByEmail,
  type StoredContact,
} from '../../services/contacts';
import {getCurrentIdentityRequired} from '../../services/storage';
import {sendEbpMail, sendPlainMail} from '../../services/mail/ebpMail';
import {appendActivityLog} from '../../services/activityLog';

type Props = NativeStackScreenProps<RootStackParamList, 'MailCompose'>;

type EncryptionIntent = 'pending' | 'encrypted' | 'unencrypted';

function looksLikeEmail(value: string): boolean {
  return value.trim().includes('@');
}

export default function MailComposeScreen({navigation}: Props): JSX.Element {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [encryptionIntent, setEncryptionIntent] =
    useState<EncryptionIntent>('pending');
  const [resolveModalVisible, setResolveModalVisible] = useState(false);
  const [preferredContacts, setPreferredContacts] = useState<StoredContact[]>(
    [],
  );

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
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
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

        <Text style={styles.section}>Message</Text>
        <Text style={styles.fieldLabel}>To</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
          value={to}
          onChangeText={onToChange}
          onBlur={() => {
            void resolveRecipientFromTo();
          }}
          placeholder="recipient@example.com"
          accessibilityLabel="To email address"
        />
        <Text style={styles.fieldLabel}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
          accessibilityLabel="Subject"
        />
        <Text style={styles.fieldLabel}>Body</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={message}
          onChangeText={setMessage}
          placeholder="Write your message..."
          multiline
          accessibilityLabel="Message body"
        />

        <Text style={styles.section}>EBP encryption</Text>
        {encryptionIntent === 'encrypted' ? (
          <>
            <Text style={styles.fieldLabel}>EBP contact</Text>
            <ContactPicker
              variant="dropdown"
              value={recipientContact}
              onChange={onRecipientContactChange}
              placeholder="Select EBP contact"
            />
            <Text style={styles.hint}>
              The message body is encrypted for the selected contact.
            </Text>
            <Text style={styles.fieldLabel}>Identity password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password for your current identity"
              secureTextEntry
              accessibilityLabel="Identity password"
            />
            <Button title="Send EBP encrypted mail" onPress={onSend} />
          </>
        ) : encryptionIntent === 'unencrypted' ? (
          <>
            <Text style={styles.hint}>
              Sending as plaintext. Change the To address to re-check contacts,
              or pick an EBP contact below to encrypt.
            </Text>
            <Text style={styles.fieldLabel}>EBP contact (optional)</Text>
            <ContactPicker
              variant="dropdown"
              value={recipientContact}
              onChange={onRecipientContactChange}
              placeholder="Select EBP contact to encrypt instead"
            />
            <Button title="Send unencrypted mail" onPress={onSend} />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Enter a To address and leave the field to resolve encryption, or
              pick an EBP contact manually.
            </Text>
            <Text style={styles.fieldLabel}>EBP contact</Text>
            <ContactPicker
              variant="dropdown"
              value={recipientContact}
              onChange={onRecipientContactChange}
              placeholder="Select EBP contact"
            />
            <Button title="Send" onPress={onSend} />
          </>
        )}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>

      <RecipientResolveModal
        visible={resolveModalVisible}
        email={to.trim()}
        preferredContacts={preferredContacts}
        onCancel={() => setResolveModalVisible(false)}
        onSelectContact={applyEncryptedContact}
        onMarkUnencrypted={applyUnencrypted}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16},
  note: {fontSize: 13, color: '#444', marginBottom: 12},
  section: {
    marginTop: 8,
    marginBottom: 8,
    fontWeight: '700',
    fontSize: 16,
    color: '#111',
  },
  fieldLabel: {fontSize: 13, color: '#333', marginBottom: 4},
  hint: {fontSize: 12, color: '#666', marginTop: -8, marginBottom: 12},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    color: '#111',
  },
  multi: {minHeight: 120, textAlignVertical: 'top'},
  status: {marginTop: 12, color: '#111'},
});
