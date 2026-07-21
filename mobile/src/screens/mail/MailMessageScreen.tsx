import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {fetchMessageDetail} from '../../services/mail/imap';
import {
  decryptMailBody,
  type MailAuthenticitySummary,
} from '../../services/mail/ebpMail';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import Card from '../../components/Card';
import BusyOverlay from '../../components/BusyOverlay';
import AuthenticityBadge from '../../components/AuthenticityBadge';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {colors, typography, spacing} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailMessage'>;

export default function MailMessageScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [body, setBody] = useState('');
  const [hasEbp, setHasEbp] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [authenticity, setAuthenticity] =
    useState<MailAuthenticitySummary | null>(null);
  const [status, setStatus] = useState('Loading message…');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setStatus('Loading message…');
      setSubject('');
      setFrom('');
      setBody('');
      setHasEbp(false);
      setShowTechnical(false);
      setAuthenticity(null);
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
        setFrom(detail.from || '');
        setBody(detail.bodyText || detail.bodyHtml || '');
        const ebp = Boolean(detail.ebpPayload);
        setHasEbp(ebp);
        setStatus(
          ebp
            ? 'Encrypted with EBP — decrypt to read'
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
      setAuthenticity(result);
      setStatus(
        result.verified
          ? 'Decrypted and verified'
          : result.verified === null
            ? 'Decrypted (unsigned)'
            : 'Decrypted (signature invalid)',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;
  const decrypted = authenticity?.plaintext ?? '';
  const locked = hasEbp && !decrypted;

  return (
    <Screen scroll>
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={statusKind(status)} />
      <Text style={styles.subject}>{subject || '(no subject)'}</Text>
      {from ? <Text style={styles.from}>From: {from}</Text> : null}

      {authenticity ? (
        <View style={styles.badgeWrap}>
          <AuthenticityBadge
            summary={authenticity}
            onPress={() =>
              navigation.navigate('MailSenderAuthenticity', {
                summary: authenticity,
              })
            }
          />
        </View>
      ) : null}

      {hasEbp && !decrypted ? (
        <AppButton title="Decrypt" onPress={onDecrypt} />
      ) : null}
      {hasEbp && decrypted ? (
        <AppButton
          title="Decrypt again"
          variant="secondary"
          onPress={onDecrypt}
        />
      ) : null}

      {locked ? (
        <Card padded>
          <Text style={styles.placeholder}>This message is encrypted.</Text>
        </Card>
      ) : null}

      {!hasEbp && body ? (
        <Card padded>
          <Text style={styles.body}>{body}</Text>
        </Card>
      ) : null}

      {decrypted ? (
        <Card padded>
          <Text style={styles.decrypted}>{decrypted}</Text>
        </Card>
      ) : null}

      {hasEbp ? (
        <Pressable
          onPress={() => setShowTechnical(v => !v)}
          style={styles.infoBtn}
          accessibilityRole="button"
          accessibilityLabel="Technical details">
          <Text style={styles.infoBtnText}>
            {showTechnical ? 'Hide technical details' : 'ⓘ Technical details'}
          </Text>
        </Pressable>
      ) : null}

      {hasEbp && showTechnical && body ? (
        <Card padded>
          <Text style={styles.techLabel}>Wire / armor payload</Text>
          <Text style={styles.techBody}>{body}</Text>
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
  from: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: typography.caption,
  },
  badgeWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.text,
    lineHeight: 20,
  },
  decrypted: {
    color: colors.text,
    lineHeight: 20,
  },
  placeholder: {
    color: colors.muted,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  infoBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoBtnText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  techLabel: {
    color: colors.muted,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  techBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
});
