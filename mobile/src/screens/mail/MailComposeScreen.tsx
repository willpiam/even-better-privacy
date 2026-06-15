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
      <ScrollView>
        <TextInput style={styles.input} value={to} onChangeText={setTo} placeholder="To email" />
        <TextInput
          style={styles.input}
          value={recipientContact}
          onChangeText={setRecipientContact}
          placeholder="Recipient contact name"
        />
        <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Subject" />
        <TextInput
          style={[styles.input, styles.multi]}
          value={message}
          onChangeText={setMessage}
          placeholder="Message"
          multiline
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Identity password"
          secureTextEntry
        />
        <Button title="Send EBP encrypted mail" onPress={onSend} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    color: '#111',
  },
  multi: {minHeight: 120, textAlignVertical: 'top'},
  status: {marginTop: 10, color: '#111'},
});
