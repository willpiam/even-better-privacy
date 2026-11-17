import {createSendQueue, type MailDraft} from '../src/services/mail/sendQueue';
const draft: MailDraft = {
  identityName: 'Alice',
  chips: [{id: '1', email: 'bob@example.com', state: 'plaintext'}],
  subject: 'Hello',
  message: 'Original',
  encrypted: false,
  attachments: [],
  inReplyTo: '<thread>',
  references: '<original>',
};
const flush = async () => {
  await Promise.resolve();
  await jest.runAllTimersAsync();
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('enqueue returns before sending, snapshots editor and publishes progress after navigation', async () => {
  let finish!: (result: {savedToSent: boolean}) => void;
  const send = jest.fn(async (_draft, progress) => {
    progress('sending');
    return new Promise<{savedToSent: boolean}>(resolve => {
      finish = resolve;
    });
  });
  const queue = createSendQueue(send);
  const changed = jest.fn();
  queue.subscribe(changed);
  const editor = {...draft};
  const id = queue.enqueue(editor);
  editor.message = 'Edited later';
  expect(send).not.toHaveBeenCalled();
  expect(queue.getSnapshot()[0].stage).toBe('queued');
  await flush();
  expect(send.mock.calls[0][0].message).toBe('Original');
  expect(queue.getSnapshot()[0].stage).toBe('sending');
  queue.dismiss(id); // Cannot hide or discard active jobs.
  expect(queue.getSnapshot()).toHaveLength(1);
  finish({savedToSent: true});
  await flush();
  expect(queue.getSnapshot()[0].stage).toBe('sent');
  expect(queue.getDraft(id)).toBeUndefined();
  expect(changed).toHaveBeenCalled();
});

test('delivery failure preserves complete draft and does not block later sends', async () => {
  const send = jest
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({savedToSent: true});
  const queue = createSendQueue(send);
  const failed = queue.enqueue(draft);
  queue.enqueue({...draft, subject: 'Second'});
  await flush();
  expect(queue.getSnapshot().map(j => j.stage)).toEqual(['failed', 'sent']);
  expect(queue.getDraft(failed)).toEqual(draft);
  expect(queue.getSnapshot()[0].error).toBe('Offline');
  queue.dismiss(failed);
  expect(queue.getDraft(failed)).toBeUndefined();
});

test('Sent save retry never sends SMTP again and coalesces repeated taps', async () => {
  let finish!: () => void;
  const retrySentCopy = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const send = jest.fn().mockResolvedValue({savedToSent: false, retrySentCopy});
  const queue = createSendQueue(send);
  const id = queue.enqueue(draft);
  await flush();
  expect(queue.getSnapshot()[0].stage).toBe('saveFailed');
  const saving = queue.retrySave(id);
  await queue.retrySave(id);
  expect(queue.getSnapshot()[0].stage).toBe('saving');
  expect(retrySentCopy).toHaveBeenCalledTimes(1);
  finish();
  await saving;
  expect(queue.getSnapshot()[0].stage).toBe('sent');
  expect(send).toHaveBeenCalledTimes(1);
});

test('failed save retry remains recoverable; submitting recovered draft removes old failure', async () => {
  const send = jest
    .fn()
    .mockResolvedValueOnce({
      savedToSent: false,
      retrySentCopy: async () => {
        throw new Error('Offline');
      },
    })
    .mockRejectedValue(new Error('Offline'));
  const queue = createSendQueue(send);
  const id = queue.enqueue(draft);
  await flush();
  await queue.retrySave(id);
  expect(queue.getSnapshot()[0].stage).toBe('saveFailed');
  const failed = queue.enqueue(draft);
  await flush();
  queue.enqueue(draft, failed);
  expect(queue.getSnapshot().some(j => j.id === failed)).toBe(false);
  await flush();
});
