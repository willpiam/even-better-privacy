import React, {useEffect, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {fetchMessageDetail} from '../../services/mail/imap';
import {decryptMailBody} from '../../services/mail/ebpMail';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import Card from '../../components/Card';
import BusyOverlay from '../../components/BusyOverlay';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailMessage'>;

export default function MailMessageScreen({route}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [hasEbp, setHasEbp] = useState(false);
  const [decrypted, setDecrypted] = useState('');
  const [status, setStatus] = useState('Loading message…');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setStatus('Loading message…');
      setSubject('');
      setBody('');
      setHasEbp(false);
      setDecrypted('');
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
        if (cancelled) {
          return;
        }
        setSubject(detail.subject);
        setBody(detail.bodyText || detail.bodyHtml || '');
        const ebp = Boolean(detail.ebpPayload);
        setHasEbp(ebp);
        setStatus(
          ebp
            ? 'EBP payload detected — decrypt with identity password'
            : '',
        );
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.params.uid]);

  const onDecrypt = async () => {
    const password = await promptSecret({
      title: 'Identity password',
      placeholder: 'Identity password to decrypt EBP',
      submitLabel: 'Decrypt',
    });
    if (password === null) {
      return;
    }
    setBusyMessage('Decrypting…');
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
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;

  return (
    <Screen scroll>
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <Text style={styles.subject}>{subject || '(no subject)'}</Text>
      {body ? (
        <Card padded>
          <Text style={styles.body}>{body}</Text>
        </Card>
      ) : null}
      {hasEbp ? (
        <AppButton title="Decrypt EBP body" onPress={onDecrypt} />
      ) : null}
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
