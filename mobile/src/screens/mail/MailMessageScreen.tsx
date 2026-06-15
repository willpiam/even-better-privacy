import React, {useEffect, useState} from 'react';
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
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {fetchMessageDetail} from '../../services/mail/imap';
import {decryptMailBody} from '../../services/mail/ebpMail';

type Props = NativeStackScreenProps<RootStackParamList, 'MailMessage'>;

export default function MailMessageScreen({route}: Props): JSX.Element {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const identityName = await getCurrentIdentityRequired();
        const resolved = await resolveSelectedAccount(identityName);
        if (!resolved) {
          throw new Error('No mail account');
        }
        const detail = await fetchMessageDetail(
          resolved.account.config,
          resolved.secrets,
          route.params.uid,
        );
        setSubject(detail.subject);
        setBody(detail.bodyText || detail.bodyHtml || '');
        if (detail.ebpPayload) {
          setStatus('EBP payload detected — decrypt with identity password');
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [route.params.uid]);

  const onDecrypt = async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
      const result = await decryptMailBody({
        identityName,
        password,
        uid: route.params.uid,
      });
      setDecrypted(result.plaintext);
      setStatus(result.verified ? 'Decrypted and verified' : 'Decrypted (unsigned)');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.subject}>{subject}</Text>
        <Text style={styles.body}>{body}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Identity password to decrypt EBP"
          secureTextEntry
        />
        <Button title="Decrypt EBP body" onPress={onDecrypt} />
        {decrypted ? <Text style={styles.decrypted}>{decrypted}</Text> : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  subject: {fontWeight: '700', fontSize: 18, color: '#111', marginBottom: 8},
  body: {color: '#222', marginBottom: 12},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    color: '#111',
  },
  decrypted: {marginTop: 12, color: '#111'},
  status: {marginTop: 10, color: '#111'},
});
