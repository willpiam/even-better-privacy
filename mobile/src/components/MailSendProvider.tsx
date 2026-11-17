import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {sendEbpMail, sendPlainMail} from '../services/mail/ebpMail';
import {readUnlockedIdentityStorage} from '../services/storage';
import {
  createSendQueue,
  type MailSendQueue,
  type SendJob,
} from '../services/mail/sendQueue';
import MailCryptoHost, {type CryptoWork} from './MailCryptoHost';
import type {
  MailCryptoRequest,
  MailCryptoResult,
} from '../services/mail/mailCryptoTypes';
import {colors} from '../theme/tokens';

const Context = createContext<MailSendQueue | null>(null);
export function useMailSendQueue() {
  const queue = useContext(Context);
  if (!queue) throw new Error('MailSendProvider is missing');
  return queue;
}
const labels: Record<SendJob['stage'], string> = {
  queued: 'Waiting to send…',
  preparing: 'Preparing message…',
  encrypting: 'Encrypting…',
  sending: 'Sending…',
  saving: 'Sent · Saving to Sent…',
  sent: 'Message sent',
  failed: 'Send failed',
  saveFailed: 'Message sent · Could not save to Sent',
};
function SendSnackbar({
  job,
  recover,
}: {
  job: SendJob;
  recover: (id: string) => void;
}) {
  const queue = useMailSendQueue();
  const busy = !['sent', 'failed', 'saveFailed'].includes(job.stage);
  useEffect(() => {
    if (job.stage !== 'sent') return;
    const timer = setTimeout(() => queue.dismiss(job.id), 5000);
    return () => clearTimeout(timer);
  }, [job.id, job.stage, queue]);
  return (
    <View style={styles.snackbar} testID={`send-job-${job.id}`}>
      {busy ? (
        <ActivityIndicator
          color={colors.accent}
          accessibilityLabel={labels[job.stage]}
        />
      ) : null}
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text style={styles.label}>{labels[job.stage]}</Text>
        <Text style={styles.detail} numberOfLines={1}>
          {job.subject || '(No subject)'}
        </Text>
        {job.error ? <Text style={styles.detail}>{job.error}</Text> : null}
        {job.stage === 'failed' ? (
          <Text style={styles.detail}>
            If the connection dropped after submission, check Sent or with the
            recipient before sending again.
          </Text>
        ) : null}
      </View>
      {job.stage === 'failed' ? (
        <Pressable accessibilityRole="button" onPress={() => recover(job.id)}>
          <Text style={styles.action}>Edit message</Text>
        </Pressable>
      ) : null}
      {job.stage === 'saveFailed' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            queue.retrySave(job.id);
          }}>
          <Text style={styles.action}>Retry save</Text>
        </Pressable>
      ) : null}
      {!busy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss send notification"
          onPress={() => queue.dismiss(job.id)}>
          <Text style={styles.action}>Dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export default function MailSendProvider({
  children,
  recover,
}: {
  children: React.ReactNode;
  recover: (id: string) => void;
}) {
  const [work, setWork] = useState<CryptoWork | null>(null);
  const serial = useRef(0);
  const [queue] = useState(() =>
    createSendQueue(async (draft, onProgress) => {
      const common = {...draft, onProgress};
      if (!draft.encrypted)
        return sendPlainMail({
          ...common,
          to: draft.chips.map(chip => chip.email).join(', '),
          recipients: draft.chips.map(chip => chip.email),
        });
      const encrypt = async (
        request: MailCryptoRequest,
      ): Promise<MailCryptoResult> => {
        const {raw, key} = await readUnlockedIdentityStorage(
          request.identityName,
        );
        return new Promise((resolve, reject) => {
          serial.current += 1;
          setWork({
            input: {...request, raw, key: Array.from(key)},
            resolve: result => {
              setWork(null);
              resolve(result);
            },
            reject: error => {
              setWork(null);
              reject(error);
            },
          });
        });
      };
      return sendEbpMail({
        ...common,
        encrypt,
        sign: true,
        recipients: draft.chips.map(chip => ({
          email: chip.email,
          contact: chip.contact ?? '',
        })),
      });
    }),
  );
  const jobs = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const insets = useSafeAreaInsets();
  return (
    <Context.Provider value={queue}>
      <View style={styles.root}>
        {children}
        {work ? <MailCryptoHost key={serial.current} work={work} /> : null}
        <ScrollView
          style={[
            styles.notifications,
            {bottom: Math.max(insets.bottom, 12) + 76},
          ]}
          keyboardShouldPersistTaps="handled">
          {jobs.map(job => (
            <SendSnackbar key={job.id} job={job} recover={recover} />
          ))}
        </ScrollView>
      </View>
    </Context.Provider>
  );
}
const styles = StyleSheet.create({
  root: {flex: 1},
  notifications: {position: 'absolute', left: 12, right: 12, maxHeight: '45%'},
  snackbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginTop: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    elevation: 6,
  },
  copy: {flex: 1},
  label: {color: colors.text, fontWeight: '600'},
  detail: {color: colors.muted, fontSize: 12, marginTop: 3},
  action: {color: colors.accent, paddingVertical: 10},
});
