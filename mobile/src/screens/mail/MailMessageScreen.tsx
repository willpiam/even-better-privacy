import React, {useEffect, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {fetchMessageDetail} from '../../services/mail/imap';
import {decryptMailBody} from '../../services/mail/ebpMail';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import Card from '../../components/Card';
import {statusKind} from '../../theme/statusKind';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailMessage'>;

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
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />
      <Text style={styles.subject}>{subject || '(no subject)'}</Text>
      <Card padded>
        <Text style={styles.body}>{body}</Text>
      </Card>
      <TextField
        label="Identity password"
        value={password}
        onChangeText={setPassword}
        placeholder="Identity password to decrypt EBP"
        secureTextEntry
      />
      <AppButton title="Decrypt EBP body" onPress={onDecrypt} />
      {decrypted ? (
        <Card padded>
          <Text style={styles.decrypted}>{decrypted}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subject: {
    fontWeight: '700',
    fontSize: typography.title,
    color: colors.text,
  },
  body: {
    color: colors.text,
    lineHeight: 20,
  },
  decrypted: {
    color: colors.text,
    lineHeight: 20,
  },
});
