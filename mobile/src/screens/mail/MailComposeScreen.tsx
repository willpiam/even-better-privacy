import React, {useState} from 'react';
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
import {getCurrentIdentityRequired} from '../../services/storage';
import {sendEbpMail} from '../../services/mail/ebpMail';
import {appendActivityLog} from '../../services/activityLog';

type Props = NativeStackScreenProps<RootStackParamList, 'MailCompose'>;

export default function MailComposeScreen({navigation}: Props): JSX.Element {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [recipientContact, setRecipientContact] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const onSend = async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>
          Compose an email and encrypt the body for an EBP contact. Your configured mail
          account delivers the message.
        </Text>

        <Text style={styles.section}>Message</Text>
        <Text style={styles.fieldLabel}>To</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
          value={to}
          onChangeText={setTo}
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
        <Text style={styles.fieldLabel}>EBP contact</Text>
        <ContactPicker
          variant="dropdown"
          value={recipientContact}
          onChange={setRecipientContact}
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
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16},
  note: {fontSize: 13, color: '#444', marginBottom: 12},
  section: {marginTop: 8, marginBottom: 8, fontWeight: '700', fontSize: 16, color: '#111'},
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
