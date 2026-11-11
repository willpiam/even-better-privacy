import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {WebView} from 'react-native-webview';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {fetchMessageDetail} from '../../services/mail/imap';
import {
  decryptMailBody,
  type MailAuthenticitySummary,
} from '../../services/mail/ebpMail';
import {buildSandboxedEmailSrcDoc} from '../../services/mail/sandboxedHtml';
import {
  extractEmailAddress,
  formatQuotedBody,
  formatReplySubject,
  parseMessageId,
  resolveReplyRecipientContact,
} from '../../services/mail/mailReply';
import {isUnlocked} from '../../services/unlockSession';
import {getMailRenderHtml} from '../../services/settings';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import Card from '../../components/Card';
import BusyOverlay from '../../components/BusyOverlay';
import AuthenticityBadge from '../../components/AuthenticityBadge';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import InlineBusy from '../../components/InlineBusy';
import {
  MailAvatar,
  MailIcon,
  mailColors,
  mailSenderLabel,
} from './MailAppearance';

type Props = NativeStackScreenProps<MailStackParamList, 'MailMessage'>;

export default function MailMessageScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const folder = route.params.folder ?? 'INBOX';
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [body, setBody] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [renderHtml, setRenderHtml] = useState(false);
  const [rawSource, setRawSource] = useState('');
  const [hasEbp, setHasEbp] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [authenticity, setAuthenticity] =
    useState<MailAuthenticitySummary | null>(null);
  const [status, setStatus] = useState('Loading message…');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [hasError, setHasError] = useState(false);
  const request = useRef(0);
  const decryptRequest = useRef<number | null>(null);

  const decrypt = useCallback(
    async (identityName: string, requestId: number) => {
      if (request.current !== requestId || decryptRequest.current === requestId)
        return;
      decryptRequest.current = requestId;
      setDecrypting(true);
      setHasError(false);
      setStatus('');
      try {
        const result = await decryptMailBody({
          identityName,
          uid: route.params.uid,
          folder,
        });
        if (request.current !== requestId) return;
        setAuthenticity(result);
      } catch (error) {
        if (request.current !== requestId) return;
        setHasError(true);
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (request.current === requestId) {
          decryptRequest.current = null;
          setDecrypting(false);
        }
      }
    },
    [route.params.uid, folder],
  );

  useEffect(() => {
    const requestId = ++request.current;
    void (async () => {
      setStatus('Loading message…');
      setHasError(false);
      setBusyMessage(null);
      setDecrypting(false);
      decryptRequest.current = null;
      setLoaded(false);
      setSubject('');
      setFrom('');
      setTo('');
      setDate('');
      setBody('');
      setBodyHtml('');
      setRawSource('');
      setHasEbp(false);
      setShowTechnical(false);
      setAuthenticity(null);
      try {
        const identityName = await getCurrentIdentityRequired();
        const resolved = await resolveSelectedAccount(identityName);
        if (!resolved) {
          throw new Error('No mail account');
        }
        const [detail, htmlSetting] = await Promise.all([
          fetchMessageDetail(
            resolved.account.config,
            resolved.secrets,
            route.params.uid,
            folder,
          ),
          getMailRenderHtml(),
        ]);
        if (request.current !== requestId) {
          return;
        }
        setSubject(detail.subject);
        setFrom(detail.from || '');
        setTo(detail.to || '');
        setDate(detail.date || '');
        setBody(detail.bodyText || detail.bodyHtml || '');
        setBodyHtml(detail.bodyHtml || '');
        setRenderHtml(htmlSetting);
        setRawSource(detail.rawSource || '');
        const ebp = Boolean(detail.ebpPayload);
        setHasEbp(ebp);
        setLoaded(true);
        setStatus('');
        // Never open a password prompt on entry. Reuse only the current identity's live session.
        if (ebp && isUnlocked(identityName)) {
          await decrypt(identityName, requestId);
        }
      } catch (error) {
        if (request.current === requestId) {
          setHasError(true);
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      request.current += 1;
    };
  }, [route.params.uid, folder, decrypt]);

  const onDecrypt = async () => {
    if (decrypting) return;
    const requestId = request.current;
    setDecrypting(true);
    try {
      const identityName = await ensureUnlocked();
      if (!identityName || request.current !== requestId) return;
      await decrypt(identityName, requestId);
    } catch (error) {
      if (request.current === requestId) {
        setHasError(true);
        setStatus(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request.current === requestId) setDecrypting(false);
    }
  };

  const onReply = async () => {
    const readableBody = authenticity?.plaintext ?? body;
    const messageId = parseMessageId(rawSource);
    const requestId = request.current;
    setBusyMessage('Preparing reply…');
    try {
      const recipientContact = hasEbp
        ? await resolveReplyRecipientContact(authenticity)
        : null;
      if (request.current !== requestId) return;
      const replyTo =
        extractEmailAddress(authenticity?.messageFrom || from) ||
        extractEmailAddress(from);
      navigation.navigate('MailCompose', {
        to: replyTo,
        subject: formatReplySubject(subject),
        message: formatQuotedBody({
          from: authenticity?.messageFrom || from,
          date,
          body: readableBody,
        }),
        recipientContact: recipientContact ?? undefined,
        encryptionIntent: recipientContact ? 'encrypted' : undefined,
        inReplyTo: messageId || undefined,
        references: messageId || undefined,
      });
    } catch (error) {
      if (request.current === requestId) {
        setHasError(true);
        setStatus(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request.current === requestId) setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;
  const decrypted = authenticity?.plaintext ?? '';
  const locked = hasEbp && authenticity === null;
  const canReply = loaded && !locked;
  const showHtml = !hasEbp && renderHtml && Boolean(bodyHtml.trim());

  return (
    <Screen scroll style={styles.screen} contentStyle={styles.content}>
      {unlockPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <StatusBanner message={status} kind={hasError ? 'error' : 'info'} />
      {loaded ? (
        <>
          <Text style={styles.subject}>{subject || '(no subject)'}</Text>
          <View style={styles.senderRow}>
            <MailAvatar address={from} />
            <View style={styles.senderCopy}>
              <Text style={styles.senderName}>{mailSenderLabel(from)}</Text>
              <Text style={styles.metadata} selectable>
                {from}
              </Text>
              {to ? (
                <Text style={styles.metadata} selectable>
                  To: {to}
                </Text>
              ) : null}
              {date ? <Text style={styles.metadata}>{date}</Text> : null}
            </View>
          </View>
        </>
      ) : null}
      {authenticity ? (
        <AuthenticityBadge
          summary={authenticity}
          onPress={() =>
            navigation.navigate('MailSenderAuthenticity', {
              summary: authenticity,
            })
          }
        />
      ) : loaded ? (
        <View style={styles.securityLine}>
          <MailIcon name={hasEbp ? 'lock' : 'mail'} />
          <Text style={styles.securityText}>
            {hasEbp
              ? 'Encrypted with EBP'
              : 'Standard email · Not EBP encrypted'}
          </Text>
        </View>
      ) : null}
      {locked ? (
        <Card padded style={styles.lockedCard}>
          <Text style={styles.lockedTitle}>This message is encrypted</Text>
          {decrypting ? (
            <InlineBusy message="Decrypting message…" />
          ) : (
            <>
              <Text style={styles.placeholder}>
                Unlock your identity to read and reply.
              </Text>
              <AppButton
                title={hasError ? 'Retry decryption' : 'Decrypt'}
                style={styles.primary}
                onPress={() => void onDecrypt()}
                disabled={busy}
              />
            </>
          )}
        </Card>
      ) : null}
      {showHtml ? (
        <Card style={styles.htmlCard}>
          <WebView
            originWhitelist={['*']}
            source={{html: buildSandboxedEmailSrcDoc(bodyHtml)}}
            javaScriptEnabled={false}
            style={styles.webview}
            nestedScrollEnabled
            testID="mail-html-webview"
          />
        </Card>
      ) : null}
      {loaded && !locked && !showHtml ? (
        <View style={styles.bodyCard}>
          <Text selectable style={styles.body}>
            {authenticity
              ? decrypted
              : body || 'This message has no text body.'}
          </Text>
        </View>
      ) : null}
      {canReply ? (
        <AppButton
          title="Reply"
          style={styles.primary}
          disabled={busy || decrypting}
          onPress={() => void onReply()}
        />
      ) : null}
      {hasEbp ? (
        <Pressable
          onPress={() => setShowTechnical(v => !v)}
          style={styles.infoBtn}
          accessibilityRole="button"
          accessibilityState={{expanded: showTechnical}}
          accessibilityLabel="Technical details">
          <Text style={styles.infoBtnText}>
            {showTechnical ? 'Hide technical details' : 'Technical details'}
          </Text>
        </Pressable>
      ) : null}
      {hasEbp && showTechnical ? (
        <Card padded>
          {authenticity ? (
            <AppButton
              title="Decrypt again"
              variant="secondary"
              disabled={busy || decrypting}
              onPress={() => void onDecrypt()}
            />
          ) : null}
          <Text style={styles.techLabel}>Wire / armor payload</Text>
          <Text selectable style={styles.techBody}>
            {body}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: mailColors.surface},
  content: {padding: 24, paddingBottom: 40, gap: 20},
  subject: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.6,
    color: mailColors.text,
  },
  senderRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  senderCopy: {flex: 1, gap: 4},
  senderName: {fontSize: 15, fontWeight: '600', color: mailColors.text},
  metadata: {color: mailColors.muted, fontSize: 12, lineHeight: 18},
  securityLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 12,
    backgroundColor: mailColors.soft,
  },
  securityText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: mailColors.muted,
  },
  lockedCard: {
    backgroundColor: mailColors.soft,
    borderColor: mailColors.border,
    borderRadius: 16,
    gap: 16,
    padding: 20,
  },
  lockedTitle: {color: mailColors.text, fontSize: 18, fontWeight: '600'},
  placeholder: {color: mailColors.muted, fontSize: 14, lineHeight: 22},
  primary: {backgroundColor: mailColors.accent},
  bodyCard: {paddingVertical: 8, minHeight: 160},
  body: {color: mailColors.text, fontSize: 16, lineHeight: 27},
  infoBtn: {minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'},
  infoBtnText: {color: mailColors.muted, fontSize: 12, fontWeight: '600'},
  techLabel: {color: mailColors.muted, fontSize: 12, marginVertical: 12},
  techBody: {
    color: mailColors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  htmlCard: {minHeight: 220, borderColor: mailColors.border, borderRadius: 12},
  webview: {height: 280, backgroundColor: mailColors.surface},
});
