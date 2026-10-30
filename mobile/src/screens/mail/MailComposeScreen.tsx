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
import SectionTitle from '../../components/SectionTitle';
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
import {colors, typography} from '../../theme/tokens';

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
  const [chips, setChips] = useState<RecipientChip[]>(() => initialChips(params));
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
        await sendPlainMail({
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
        setStatus('Unencrypted message sent');
        navigation.goBack();
        return;
      }
      const unlocked = await ensureUnlocked(identityName);
      if (!unlocked) {
        return;
      }
      await sendEbpMail({
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
      setStatus('EBP message sent');
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
      ? `The message body is encrypted for ${chips.length === 1 ? 'the selected contact' : 'the selected contacts'}.`
      : intent.kind === 'plaintext'
        ? 'Sending as plaintext. Tap a recipient to choose a contact and encrypt instead.'
        : intent.kind === 'blocked'
          ? intent.message
          : 'Add recipients. Separate addresses with a comma.';

  return (
    <Screen scroll>
      {unlockPrompt}
      <Text style={styles.note}>
        Type or paste addresses. Each one becomes a chip and is checked against
        your contacts, then the key server. Encrypted by default when every
        recipient resolves.
      </Text>

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

      <SectionTitle>Recipients</SectionTitle>
      <RecipientChipsField chips={chips} onChange={setChips} />

      <SectionTitle>Message</SectionTitle>
      <TextField
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        placeholder="Subject"
        accessibilityLabel="Subject"
      />
      <TextField
        label="Body"
        value={message}
        onChangeText={setMessage}
        placeholder="Write your message..."
        multiline
        accessibilityLabel="Message body"
        style={styles.bodyField}
      />

      <SectionTitle>Attachments</SectionTitle>
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

      <SectionTitle>Send</SectionTitle>
      <Text style={styles.hint}>{sendHint}</Text>
      <AppButton
        title={sendTitle}
        onPress={onSend}
        disabled={intent.kind !== 'encrypted' && intent.kind !== 'plaintext'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    color: colors.muted,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.muted,
  },
  bodyField: {
    minHeight: 120,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  attachmentName: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
  },
});
