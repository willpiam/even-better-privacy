import type {RecipientChip} from './recipientChipsLogic';
import type {MailAttachmentPart} from './mime';
import type {SendProgress, SendResult} from './ebpMail';

export type MailDraft = {
  identityName: string;
  accountId?: string;
  chips: RecipientChip[];
  subject: string;
  message: string;
  inReplyTo?: string;
  references?: string;
  attachments: MailAttachmentPart[];
  encrypted: boolean;
};
export type SendJob = {
  id: string;
  stage: 'queued' | SendProgress | 'sent' | 'failed' | 'saveFailed';
  subject: string;
  error?: string;
};
type Send = (
  draft: MailDraft,
  progress: (stage: SendProgress) => void,
) => Promise<SendResult>;

/** Session-scoped queue. Failures keep their drafts until explicitly dismissed. */
export function createSendQueue(send: Send) {
  let jobs: SendJob[] = [];
  let nextId = 0;
  let tail = Promise.resolve();
  const drafts = new Map<string, MailDraft>();
  const saves = new Map<string, () => Promise<void>>();
  const listeners = new Set<() => void>();
  const update = (id: string, change: Partial<SendJob>) => {
    jobs = jobs.map(job => (job.id === id ? {...job, ...change} : job));
    listeners.forEach(listener => listener());
  };
  const dismiss = (id: string) => {
    if (
      jobs.some(
        job =>
          job.id === id &&
          !['sent', 'failed', 'saveFailed'].includes(job.stage),
      )
    )
      return;
    drafts.delete(id);
    saves.delete(id);
    jobs = jobs.filter(job => job.id !== id);
    listeners.forEach(listener => listener());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => jobs,
    getDraft: (id: string) => drafts.get(id),
    dismiss,
    enqueue(draft: MailDraft, recoveredId?: string) {
      const id = String(++nextId);
      // Snapshot the editor before navigation/unmount; later edits cannot mutate a send.
      const snapshot: MailDraft = {
        ...draft,
        chips: JSON.parse(JSON.stringify(draft.chips)),
        attachments: draft.attachments.map(attachment => ({...attachment})),
      };
      drafts.set(id, snapshot);
      jobs = [...jobs, {id, stage: 'queued', subject: draft.subject}];
      listeners.forEach(listener => listener());
      if (recoveredId) dismiss(recoveredId);
      tail = tail.then(async () => {
        // Give React a turn to navigate and paint the initial progress state.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        try {
          update(id, {stage: 'preparing'});
          const result = await send(snapshot, stage => update(id, {stage}));
          drafts.delete(id);
          if (result.savedToSent) update(id, {stage: 'sent'});
          else {
            if (result.retrySentCopy) saves.set(id, result.retrySentCopy);
            update(id, {stage: 'saveFailed'});
          }
        } catch (error) {
          update(id, {
            stage: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return id;
    },
    async retrySave(id: string) {
      const save = saves.get(id);
      if (!save || jobs.find(job => job.id === id)?.stage !== 'saveFailed')
        return;
      update(id, {stage: 'saving', error: undefined});
      try {
        await save();
        saves.delete(id);
        update(id, {stage: 'sent'});
      } catch (error) {
        update(id, {
          stage: 'saveFailed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
export type MailSendQueue = ReturnType<typeof createSendQueue>;
