import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import RecipientChipsField from '../../components/RecipientChipsField';
import StatusBanner from '../../components/StatusBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import {getCurrentIdentityRequired} from '../../services/storage';
import {sendEbpMail, sendPlainMail} from '../../services/mail/ebpMail';
import {ENCRYPTED_MAIL_ATTACHMENT_ERROR} from '../../services/mail/ebpMailLogic';
import {
  chipsFromInitial,
  deriveComposeIntent,
  type RecipientChip,
} from '../../services/mail/recipientChipsLogic';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import type {MailAttachmentPart} from '../../services/mail/mime';
import {appendActivityLog} from '../../services/activityLog';
import {statusKind} from '../../theme/statusKind';
import {MailIcon, mailColors} from './MailAppearance';

type Props = NativeStackScreenProps<MailStackParamList, 'MailCompose'>;

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
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [chips, setChips] = useState<RecipientChip[]>(() =>
    initialChips(params),
  );
  const [subject, setSubject] = useState(params?.subject ?? '');
  const [message, setMessage] = useState(params?.message ?? '');
  const [status, setStatus] = useState('');
  const [attachments, setAttachments] = useState<MailAttachmentPart[]>([]);
  const inReplyTo = params?.inReplyTo;
  const references = params?.references;

  const pickAttachment = async () => {
    try {
      const [file] = await pick({mode: 'open'});
      const [copyResult] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: file.name ?? 'attachment'}],
        destination: 'cachesDirectory',
      });
      if (copyResult.status !== 'success') {
        throw new Error(copyResult.copyError);
      }
      const path = copyResult.localUri.startsWith('file://')
        ? copyResult.localUri.replace('file://', '')
        : copyResult.localUri;
      const contentBase64 = await RNFS.readFile(path, 'base64');
      setAttachments(prev => [
        ...prev,
        {
          filename: file.name ?? 'attachment',
          contentType: file.type ?? 'application/octet-stream',
          contentBase64,
        },
      ]);
    } catch {
      // User cancelled picker.
    }
  };

  const intent = deriveComposeIntent(chips);

  const onSend = async () => {
    try {
      if (intent.kind === 'empty' || intent.kind === 'blocked') {
        setStatus(
          intent.kind === 'blocked'
            ? intent.message
            : 'Add at least one recipient.',
        );
        return;
      }
      const identityName = await getCurrentIdentityRequired();
      const emails = chips.map(chip => chip.email);
      if (intent.kind === 'plaintext') {
        const sent = await sendPlainMail({
          identityName,
          to: emails.join(', '),
          recipients: emails,
          subject,
          message,
          inReplyTo,
          references,
          attachments,
        });
        await appendActivityLog(
          `Sent unencrypted mail to ${emails.join(', ')}`,
          'success',
        );
        setStatus(
          sent.savedToSent
            ? 'Message sent. Open Sent to view it.'
            : 'Message sent, but a copy could not be saved to Sent',
        );
        navigation.goBack();
        return;
      }
      const unlocked = await ensureUnlocked(identityName);
      if (!unlocked) {
        return;
      }
      const sent = await sendEbpMail({
        identityName: unlocked,
        subject,
        message,
        recipients: chips.map(chip => ({
          email: chip.email,
          contact: chip.contact ?? '',
        })),
        sign: true,
        inReplyTo,
        references,
        attachments,
      });
      await appendActivityLog(
        `Sent EBP mail to ${emails.join(', ')}`,
        'success',
      );
      setStatus(
        sent.savedToSent
          ? 'Message sent. Open Sent to view it.'
          : 'Message sent, but a copy could not be saved to Sent',
      );
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
    <Screen scroll style={styles.screen} contentStyle={styles.content}>
      {unlockPrompt}
      <View style={styles.composeHeading}>
        <MailIcon name="compose" />
        <View style={styles.headingCopy}>
          <Text style={styles.title}>A new conversation</Text>
          <Text style={styles.note}>
            Encrypted when every recipient has a contact identity.
          </Text>
        </View>
      </View>

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
        <Text style={styles.sectionLabel}>ATTACHMENTS</Text>
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
        onPress={() => void pickAttachment()}
      />
      {intent.kind === 'encrypted' && attachments.length > 0 ? (
        <Text style={styles.hint}>
          Attachments are not encrypted on mobile yet. Remove them to send this
          message, or mark every recipient as unencrypted.
        </Text>
      ) : null}

      <View style={styles.sendContext}>
        <MailIcon name={intent.kind === 'encrypted' ? 'lock' : 'mail'} />
        <Text style={styles.sendHint}>{sendHint}</Text>
      </View>
      <AppButton
        title={sendTitle}
        style={
          intent.kind === 'encrypted' || intent.kind === 'plaintext'
            ? styles.primary
            : undefined
        }
        onPress={onSend}
        disabled={intent.kind !== 'encrypted' && intent.kind !== 'plaintext'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: mailColors.page},
  content: {padding: 20, paddingBottom: 40, gap: 16},
  composeHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 8,
  },
  headingCopy: {flex: 1, gap: 6},
  title: {
    fontSize: 23,
    color: mailColors.text,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  editor: {
    backgroundColor: mailColors.surface,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: mailColors.border,
    borderRadius: 16,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: mailColors.muted,
    fontWeight: '600',
  },
  sendContext: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: mailColors.soft,
    borderRadius: 12,
  },
  sendHint: {flex: 1, fontSize: 13, lineHeight: 20, color: mailColors.muted},
  primary: {backgroundColor: mailColors.accent},
  note: {
    fontSize: 13,
    color: mailColors.muted,
  },
  hint: {
    fontSize: 13,
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
