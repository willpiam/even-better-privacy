import React, {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import ContactPicker from '../../components/ContactPicker';
import RecipientResolveModal from '../../components/RecipientResolveModal';
import StatusBanner from '../../components/StatusBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import SectionTitle from '../../components/SectionTitle';
import {
  findContactsByEmail,
  type StoredContact,
} from '../../services/contacts';
import {getCurrentIdentityRequired} from '../../services/storage';
import {sendEbpMail, sendPlainMail} from '../../services/mail/ebpMail';
import type {MailAttachmentPart} from '../../services/mail/mime';
import {appendActivityLog} from '../../services/activityLog';
import {statusKind} from '../../theme/statusKind';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailCompose'>;

type EncryptionIntent = 'pending' | 'encrypted' | 'unencrypted';

type RecipientRow = {
  id: string;
  to: string;
  recipientContact: string;
  encryptionIntent: EncryptionIntent;
};

function looksLikeEmail(value: string): boolean {
  return value.trim().includes('@');
}

function newRow(partial?: Partial<RecipientRow>): RecipientRow {
  return {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    to: '',
    recipientContact: '',
    encryptionIntent: 'pending',
    ...partial,
  };
}

function initialRows(params: Props['route']['params']): RecipientRow[] {
  if (params?.to || params?.recipientContact || params?.encryptionIntent) {
    let intent: EncryptionIntent = 'pending';
    if (params.encryptionIntent === 'encrypted' || params.recipientContact) {
      intent = 'encrypted';
    } else if (params.encryptionIntent === 'unencrypted') {
      intent = 'unencrypted';
    }
    return [
      newRow({
        to: params.to ?? '',
        recipientContact: params.recipientContact ?? '',
        encryptionIntent: intent,
      }),
    ];
  }
  return [newRow()];
}

export default function MailComposeScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const params = route.params;
  const [rows, setRows] = useState<RecipientRow[]>(() => initialRows(params));
  const [subject, setSubject] = useState(params?.subject ?? '');
  const [message, setMessage] = useState(params?.message ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [attachments, setAttachments] = useState<MailAttachmentPart[]>([]);
  const [resolveRowId, setResolveRowId] = useState<string | null>(null);
  const [preferredContacts, setPreferredContacts] = useState<StoredContact[]>(
    [],
  );
  const inReplyTo = params?.inReplyTo;
  const references = params?.references;

  const updateRow = useCallback(
    (id: string, patch: Partial<RecipientRow>) => {
      setRows(prev => prev.map(r => (r.id === id ? {...r, ...patch} : r)));
    },
    [],
  );

  const applyEncryptedContact = useCallback(
    (name: string) => {
      if (!resolveRowId) {
        return;
      }
      updateRow(resolveRowId, {
        recipientContact: name,
        encryptionIntent: 'encrypted',
      });
      setResolveRowId(null);
      setPreferredContacts([]);
      setStatus('');
    },
    [resolveRowId, updateRow],
  );

  const applyUnencrypted = useCallback(() => {
    if (!resolveRowId) {
      return;
    }
    updateRow(resolveRowId, {
      recipientContact: '',
      encryptionIntent: 'unencrypted',
    });
    setResolveRowId(null);
    setPreferredContacts([]);
    setStatus('');
  }, [resolveRowId, updateRow]);

  const resolveRecipientFromTo = async (row: RecipientRow) => {
    const address = row.to.trim();
    if (!looksLikeEmail(address)) {
      return;
    }
    try {
      const matches = await findContactsByEmail(address);
      if (matches.length === 1) {
        updateRow(row.id, {
          recipientContact: matches[0].name,
          encryptionIntent: 'encrypted',
        });
        return;
      }
      setPreferredContacts(matches);
      updateRow(row.id, {
        recipientContact: '',
        encryptionIntent: 'pending',
      });
      setResolveRowId(row.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

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

  const overallIntent = (): EncryptionIntent => {
    if (rows.some(r => r.encryptionIntent === 'pending')) {
      return 'pending';
    }
    if (rows.every(r => r.encryptionIntent === 'unencrypted')) {
      return 'unencrypted';
    }
    if (rows.every(r => r.encryptionIntent === 'encrypted')) {
      return 'encrypted';
    }
    return 'pending';
  };

  const onSend = async () => {
    try {
      const intent = overallIntent();
      if (intent === 'pending') {
        setStatus('Resolve recipient encryption for every To row first');
        return;
      }
      if (rows.some(r => !r.to.trim())) {
        setStatus('Each recipient row needs an email address');
        return;
      }
      const identityName = await getCurrentIdentityRequired();
      const emails = rows.map(r => r.to.trim());
      if (intent === 'unencrypted') {
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
      if (rows.some(r => !r.recipientContact.trim())) {
        setStatus('Select an EBP contact for every recipient');
        return;
      }
      await sendEbpMail({
        identityName,
        password,
        subject,
        message,
        recipients: rows.map(r => ({
          email: r.to.trim(),
          contact: r.recipientContact.trim(),
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

  const intent = overallIntent();
  const showUnencryptedWarning = intent === 'unencrypted';
  const resolveEmail =
    rows.find(r => r.id === resolveRowId)?.to.trim() ?? '';

  return (
    <Screen scroll>
      <Text style={styles.note}>
        Compose an email. After you enter a To address, the app checks your
        contacts for a matching email or opaque email detail. Add multiple To
        rows for multi-recipient send.
      </Text>

      {showUnencryptedWarning ? (
        <StatusBanner
          kind="error"
          message="This message will not be encrypted because an EBP recipient identity could not be found nor was specified."
        />
      ) : null}

      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Recipients</SectionTitle>
      {rows.map((row, index) => (
        <View key={row.id} style={styles.recipientBlock}>
          <TextField
            label={rows.length > 1 ? `To ${index + 1}` : 'To'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={row.to}
            onChangeText={next =>
              updateRow(row.id, {
                to: next,
                encryptionIntent: 'pending',
                recipientContact: '',
              })
            }
            onBlur={() => {
              void resolveRecipientFromTo(row);
            }}
            placeholder="recipient@example.com"
            accessibilityLabel={`To email address ${index + 1}`}
          />
          <ContactPicker
            variant="dropdown"
            value={row.recipientContact}
            onChange={name =>
              updateRow(row.id, {
                recipientContact: name,
                encryptionIntent: name.trim() ? 'encrypted' : 'pending',
              })
            }
            placeholder="Select EBP contact"
          />
          {rows.length > 1 ? (
            <AppButton
              title="Remove recipient"
              variant="secondary"
              onPress={() =>
                setRows(prev => prev.filter(r => r.id !== row.id))
              }
            />
          ) : null}
        </View>
      ))}
      <AppButton
        title="Add recipient"
        variant="secondary"
        onPress={() => setRows(prev => [...prev, newRow()])}
      />

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

      <SectionTitle>Send</SectionTitle>
      {intent === 'encrypted' ? (
        <>
          <Text style={styles.hint}>
            The message body is encrypted for the selected contact
            {rows.length > 1 ? 's' : ''}.
          </Text>
          <TextField
            label="Identity password"
            value={password}
            onChangeText={setPassword}
            placeholder="Password for your current identity"
            secureTextEntry
            accessibilityLabel="Identity password"
          />
          <AppButton title="Send EBP encrypted mail" onPress={onSend} />
        </>
      ) : intent === 'unencrypted' ? (
        <>
          <Text style={styles.hint}>
            Sending as plaintext. Change a To address to re-check contacts, or
            pick EBP contacts above to encrypt.
          </Text>
          <AppButton title="Send unencrypted mail" onPress={onSend} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Resolve encryption for every recipient (leave To fields to check
            contacts, or pick contacts manually).
          </Text>
          <AppButton title="Send" onPress={onSend} />
        </>
      )}

      <RecipientResolveModal
        visible={resolveRowId !== null}
        email={resolveEmail}
        preferredContacts={preferredContacts}
        onCancel={() => setResolveRowId(null)}
        onSelectContact={applyEncryptedContact}
        onMarkUnencrypted={applyUnencrypted}
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
  recipientBlock: {
    gap: 8,
    marginBottom: 8,
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
