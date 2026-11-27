import React, {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
} from '@react-native-documents/picker';
import {Buffer} from 'buffer';
import RNFS from 'react-native-fs';
import {MAX_MAIL_ATTACHMENT_BYTES} from '../../../../common/MailLimits';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import RecipientChipsField from '../../components/RecipientChipsField';
import StatusBanner from '../../components/StatusBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {useMailSendQueue} from '../../components/MailSendProvider';
import {rejectEncryptedMailAttachments} from '../../services/mail/ebpMailLogic';
import {ENCRYPTED_MAIL_ATTACHMENT_ERROR} from '../../services/mail/ebpMailLogic';
import {
  chipsFromInitial,
  deriveComposeIntent,
  type RecipientChip,
} from '../../services/mail/recipientChipsLogic';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import type {MailAttachmentPart} from '../../services/mail/mime';
import {statusKind} from '../../theme/statusKind';
import {MailIcon, mailColors} from './MailAppearance';
import {places, PlaceThemeProvider} from '../../theme/PlaceTheme';
import {radius, spacing, typography} from '../../theme/tokens';
import SectionTitle from '../../components/SectionTitle';

type Props = NativeStackScreenProps<MailStackParamList, 'MailCompose'>;

const attachmentLimitMessage =
  `Attachments can total up to ${MAX_MAIL_ATTACHMENT_BYTES / (1024 * 1024)} MiB per message.`;

function initialChips(params: Props['route']['params']): RecipientChip[] {
  if (!params?.to && !params?.recipientContact) {
    return [];
  }
  return chipsFromInitial([
    {
      email: params.to ?? '',
      contact: params.recipientContact,
      intent: params.encryptionIntent,
    },
  ]);
}

export default function MailComposeScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const params = route.params;
  const queue = useMailSendQueue();
  const recovered = params?.draftId
    ? queue.getDraft(params.draftId)
    : undefined;
  const sending = useRef(false);
  const pickingAttachment = useRef(false);
  const [starting, setStarting] = useState(false);
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [chips, setChips] = useState<RecipientChip[]>(
    () => recovered?.chips ?? initialChips(params),
  );
  const [subject, setSubject] = useState(
    recovered?.subject ?? params?.subject ?? '',
  );
  const [message, setMessage] = useState(
    recovered?.message ?? params?.message ?? '',
  );
  const [status, setStatus] = useState('');
  const [attachments, setAttachments] = useState<MailAttachmentPart[]>(
    recovered?.attachments ?? [],
  );
  const inReplyTo = recovered?.inReplyTo ?? params?.inReplyTo;
  const references = recovered?.references ?? params?.references;

  const pickAttachment = async () => {
    if (pickingAttachment.current) return;
    pickingAttachment.current = true;
    setStatus('');
    let path: string | undefined;
    try {
      const [file] = await pick({mode: 'open'});
      const attachedBytes = attachments.reduce(
        (sum, item) => sum + Buffer.byteLength(item.contentBase64, 'base64'),
        0,
      );
      const remaining = MAX_MAIL_ATTACHMENT_BYTES - attachedBytes;
      if (remaining < 0 || (file.size !== null && file.size > remaining)) {
        throw new Error(attachmentLimitMessage);
      }
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: 'attachment'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status !== 'success') {
        throw new Error(copyResult.copyError);
      }
      path = copyResult.localUri.replace(/^file:\/\//, '');
      const size = Number((await RNFS.stat(path)).size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error('Could not determine the attachment size.');
      }
      if (size > remaining) throw new Error(attachmentLimitMessage);
      const contentBase64 = size === 0
        ? ''
        : await RNFS.read(path, size + 1, 0, 'base64');
      if (Buffer.byteLength(contentBase64, 'base64') !== size) {
        throw new Error('The attachment changed while it was being read. Choose it again.');
      }
      setAttachments(prev => [
        ...prev,
        {
          filename: file.name ?? 'attachment',
          contentType: file.type ?? 'application/octet-stream',
          contentBase64,
        },
      ]);
    } catch (error) {
      if (!isErrorWithCode(error) || error.code !== errorCodes.OPERATION_CANCELED) {
        setStatus(error instanceof Error ? error.message : 'Could not attach the file.');
      }
    } finally {
      if (path) await RNFS.unlink(path).catch(() => {});
      pickingAttachment.current = false;
    }
  };

  const intent = deriveComposeIntent(chips);

  const onSend = async () => {
    if (sending.current) return;
    sending.current = true;
    setStarting(true);
    let queued = false;
    try {
      if (intent.kind === 'empty' || intent.kind === 'blocked') {
        throw new Error(
          intent.kind === 'blocked'
            ? intent.message
            : 'Add at least one recipient.',
        );
      }
      if (intent.kind === 'encrypted')
        rejectEncryptedMailAttachments(attachments);
      const identityName = await getCurrentIdentityRequired();
      if (recovered && recovered.identityName !== identityName) {
        throw new Error(
          `Switch to ${recovered.identityName} to recover this message.`,
        );
      }
      const unlocked = await ensureUnlocked(identityName);
      if (!unlocked) return;
      const account = await resolveSelectedAccount(
        unlocked,
        recovered?.accountId,
      );
      if (!account) throw new Error('No mail account configured');
      queue.enqueue(
        {
          identityName: unlocked,
          accountId: account.account.id,
          chips,
          subject,
          message,
          inReplyTo,
          references,
          attachments,
          encrypted: intent.kind === 'encrypted',
        },
        params?.draftId,
      );
      queued = true;
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (!queued) {
        sending.current = false;
        setStarting(false);
      }
    }
  };

  const sendTitle =
    intent.kind === 'encrypted'
      ? 'Send EBP encrypted mail'
      : intent.kind === 'plaintext'
      ? 'Send unencrypted mail'
      : 'Send';
  const sendHint =
    intent.kind === 'encrypted'
      ? `The message body is encrypted for ${
          chips.length === 1 ? 'the selected contact' : 'the selected contacts'
        }.`
      : intent.kind === 'plaintext'
      ? 'Sending as plaintext. Tap a recipient to choose a contact and encrypt instead.'
      : intent.kind === 'blocked'
      ? intent.message
      : 'Add recipients. Separate addresses with a comma.';

  return (
    <PlaceThemeProvider place="compose">
      <Screen scroll>
        {unlockPrompt}
        {intent.kind === 'plaintext' ? (
          <StatusBanner
            kind="error"
            message="This message will not be encrypted."
          />
        ) : null}

        <StatusBanner
          message={status}
          kind={
            status === ENCRYPTED_MAIL_ATTACHMENT_ERROR
              ? 'error'
              : statusKind(status)
          }
        />

        <View style={styles.editor}>
          <RecipientChipsField chips={chips} onChange={setChips} />

          <TextField
            label="Subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="Subject"
            accessibilityLabel="Subject"
          />
          <TextField
            label="Message"
            value={message}
            onChangeText={setMessage}
            placeholder="Write your message…"
            multiline
            accessibilityLabel="Message body"
            style={styles.bodyField}
          />
        </View>
        {attachments.length > 0 ? (
          <SectionTitle>Attachments</SectionTitle>
        ) : null}
        {attachments.map((item, index) => (
          <View key={`${item.filename}-${index}`} style={styles.attachmentRow}>
            <Text style={styles.attachmentName}>{item.filename}</Text>
            <AppButton
              title="Remove"
              variant="secondary"
              onPress={() =>
                setAttachments(prev => prev.filter((_, i) => i !== index))
              }
            />
          </View>
        ))}
        <AppButton
          title="Add attachment"
          variant="secondary"
          onPress={pickAttachment}
        />
        {intent.kind === 'encrypted' && attachments.length > 0 ? (
          <Text style={styles.hint}>
            Attachments are not encrypted on mobile yet. Remove them to send
            this message, or mark every recipient as unencrypted.
          </Text>
        ) : null}

        <View style={styles.sendContext}>
          <MailIcon
            name={intent.kind === 'encrypted' ? 'lock' : 'mail'}
            color={places.compose.accent}
          />
          <Text style={styles.sendHint}>{sendHint}</Text>
        </View>
        <AppButton
          title={sendTitle}
          loading={starting}
          onPress={onSend}
          disabled={intent.kind !== 'encrypted' && intent.kind !== 'plaintext'}
        />
      </Screen>
    </PlaceThemeProvider>
  );
}

const styles = StyleSheet.create({
  editor: {gap: spacing.md},
  sendContext: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: places.compose.soft,
    borderRadius: radius.sm,
  },
  sendHint: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 20,
    color: mailColors.muted,
  },
  note: {
    fontSize: typography.caption,
    color: mailColors.muted,
  },
  hint: {
    fontSize: typography.caption,
    color: mailColors.muted,
  },
  bodyField: {
    minHeight: 180,
    maxHeight: 360,
    lineHeight: 25,
    color: mailColors.text,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  attachmentName: {
    flex: 1,
    color: mailColors.text,
    fontSize: 15,
  },
});
