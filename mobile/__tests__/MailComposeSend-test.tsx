import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import {MAX_MAIL_ATTACHMENT_BYTES} from '../../common/MailLimits';
const mockEnqueue = jest.fn();
const mockGetDraft = jest.fn();
const mockUnlock = jest.fn();
jest.mock('../src/components/MailSendProvider', () => ({
  useMailSendQueue: () => ({enqueue: mockEnqueue, getDraft: mockGetDraft}),
}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentityRequired: async () => 'Alice',
}));
jest.mock('../src/services/mail/accountStore', () => ({
  resolveSelectedAccount: async () => ({account: {id: 'account'}}),
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: () => ({ensureUnlocked: mockUnlock, unlockPrompt: null}),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  isErrorWithCode: () => false,
}));
jest.mock('react-native-fs', () => ({
  stat: jest.fn(),
  read: jest.fn(),
  unlink: jest.fn(async () => {}),
}));
jest.mock('../src/components/RecipientChipsField', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/screens/mail/MailAppearance', () => ({
  ...jest.requireActual('../src/screens/mail/MailAppearance'),
  MailIcon: () => null,
}));
import MailComposeScreen from '../src/screens/mail/MailComposeScreen';
import AppButton from '../src/components/AppButton';
type Props = React.ComponentProps<typeof MailComposeScreen>;
let tree: renderer.ReactTestRenderer;
const goBack = jest.fn();
async function render(params: Props['route']['params']) {
  await act(async () => {
    tree = renderer.create(
      <MailComposeScreen
        navigation={{goBack} as unknown as Props['navigation']}
        route={{params} as Props['route']}
      />,
    );
  });
}
const sendButton = () =>
  tree.root
    .findAllByType(AppButton)
    .find(b => b.props.title.startsWith('Send'))!;
const addAttachment = () => tree.root
  .findAllByType(AppButton)
  .find(b => b.props.title === 'Add attachment')!.props.onPress();
beforeEach(() => {
  jest.clearAllMocks();
  mockUnlock.mockResolvedValue('Alice');
});
afterEach(() => {
  act(() => tree?.unmount());
});

test('queues encrypted mail and navigates immediately, blocking duplicate taps', async () => {
  await render({
    to: 'bob@example.com',
    recipientContact: 'Bob',
    subject: 'Hello',
    message: 'Secret',
  });
  const press = sendButton().props.onPress;
  await act(async () => {
    await Promise.all([press(), press()]);
  });
  expect(mockUnlock).toHaveBeenCalled();
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockEnqueue.mock.calls[0][0]).toMatchObject({
    encrypted: true,
    identityName: 'Alice',
    accountId: 'account',
    message: 'Secret',
  });
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(sendButton().props.loading).toBe(true);
});
test('cancelled unlock keeps compose open without queuing', async () => {
  mockUnlock.mockResolvedValue(null);
  await render({to: 'bob@example.com', recipientContact: 'Bob'});
  await act(async () => {
    await sendButton().props.onPress();
  });
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
  expect(sendButton().props.loading).toBe(false);
});
test('restores all recipients, attachments and threading from a failed draft', async () => {
  const draft = {
    identityName: 'Alice',
    accountId: 'account',
    subject: 'Recovered',
    message: 'Draft',
    chips: [
      {id: 'a', email: 'a@example.com', state: 'plaintext'},
      {id: 'b', email: 'b@example.com', state: 'plaintext'},
    ],
    attachments: [
      {filename: 'test.txt', contentType: 'text/plain', contentBase64: 'aGk='},
    ],
    inReplyTo: '<reply>',
    references: '<thread>',
  };
  mockGetDraft.mockReturnValue(draft);
  await render({draftId: 'failed'});
  await act(async () => {
    await sendButton().props.onPress();
  });
  expect(mockEnqueue).toHaveBeenCalledWith(
    {...draft, encrypted: false},
    'failed',
  );
  expect(goBack).toHaveBeenCalledTimes(1);
});
test('invalid recipients show an error without navigation', async () => {
  await render(undefined);
  await act(async () => {
    await sendButton().props.onPress();
  });
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
  expect(
    tree.root
      .findAllByType(Text)
      .some(t =>
        String(t.props.children).includes('Add at least one recipient'),
      ),
  ).toBe(true);
});

test('enforces the combined attachment budget before copying a known large file', async () => {
  await render({to: 'a@example.com', encryptionIntent: 'unencrypted'});
  jest.mocked(pick).mockResolvedValueOnce([{uri: 'content://small', name: 'small.txt', size: 1}] as never);
  jest.mocked(keepLocalCopy).mockResolvedValueOnce([{status: 'success', localUri: 'file:///small'}] as never);
  jest.mocked(RNFS.stat).mockResolvedValueOnce({size: 1} as never);
  jest.mocked(RNFS.read).mockResolvedValueOnce('YQ==');
  await act(addAttachment);
  expect(RNFS.read).toHaveBeenCalledWith('/small', 2, 0, 'base64');
  expect(RNFS.unlink).toHaveBeenCalledWith('/small');

  jest.mocked(pick).mockResolvedValueOnce([{
    uri: 'content://large', name: 'large.mp4', size: MAX_MAIL_ATTACHMENT_BYTES,
  }] as never);
  await act(addAttachment);
  expect(keepLocalCopy).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(Text).some(node =>
    String(node.props.children).includes('20 MiB'),
  )).toBe(true);
});

test('checks the size of a copied attachment when the picker supplies no size', async () => {
  await render({to: 'a@example.com', encryptionIntent: 'unencrypted'});
  jest.mocked(pick).mockResolvedValueOnce([{uri: 'content://large', name: 'large.mp4', size: null}] as never);
  jest.mocked(keepLocalCopy).mockResolvedValueOnce([{status: 'success', localUri: 'file:///large'}] as never);
  jest.mocked(RNFS.stat).mockResolvedValueOnce({size: MAX_MAIL_ATTACHMENT_BYTES + 1} as never);
  await act(addAttachment);
  expect(RNFS.read).not.toHaveBeenCalled();
  expect(RNFS.unlink).toHaveBeenCalledWith('/large');
});
