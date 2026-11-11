import React from 'react';
import {clearMailDataCache} from '../src/services/mail/mailCache';
import renderer, {act} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentityRequired: jest.fn(),
}));
jest.mock('../src/services/mail/accountStore', () => ({
  getMailSecretsStatus: jest.fn(),
  resolveSelectedAccount: jest.fn(),
}));
jest.mock('../src/services/mail/imap', () => ({
  clampMailLimit: (n: number) => Math.max(1, Math.min(n, 100)),
  listMailboxMessages: jest.fn(),
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: () => ({ensureUnlocked: jest.fn(), unlockPrompt: null}),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/screens/mail/MailAppearance', () => ({
  ...jest.requireActual('../src/screens/mail/MailAppearance'),
  MailIcon: () => null,
}));

import MailInboxScreen from '../src/screens/mail/MailInboxScreen';
import AppButton from '../src/components/AppButton';
import {getCurrentIdentityRequired} from '../src/services/storage';
import {
  getMailSecretsStatus,
  resolveSelectedAccount,
} from '../src/services/mail/accountStore';
import {listMailboxMessages} from '../src/services/mail/imap';

type Props = React.ComponentProps<typeof MailInboxScreen>;
const navigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
} as unknown as Props['navigation'];
const message = {
  uid: 42,
  subject: 'Hello there',
  from: 'Alex <alex@example.com>',
  to: 'Jamie <jamie@example.com>',
  date: 'Tue, 10 Nov 2026 12:00:00 +0000',
  seen: false,
};
const mailbox = {
  messages: [message],
  folder: 'INBOX',
  found: true,
  page: 1,
  totalPages: 2,
  total: 21,
};
let tree: renderer.ReactTestRenderer;
const text = () =>
  tree.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
function press(label: string) {
  return tree.root
    .findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )
    .find(
      node =>
        node.props.accessibilityLabel === label ||
        node.findAllByType(Text).some(child => child.props.children === label),
    )!
    .props.onPress();
}
async function mount() {
  await act(async () => {
    tree = renderer.create(
      <MailInboxScreen
        navigation={navigation}
        route={{key: 'inbox', name: 'MailInbox'}}
      />,
    );
  });
}
beforeEach(() => {
  clearMailDataCache();
  jest.clearAllMocks();
  jest.mocked(getCurrentIdentityRequired).mockResolvedValue('Personal');
  jest
    .mocked(getMailSecretsStatus)
    .mockResolvedValue({locked: false, inMemory: true} as never);
  jest.mocked(resolveSelectedAccount).mockResolvedValue({
    account: {config: {fromEmail: 'jamie@example.com'}},
    secrets: {},
  } as never);
  jest.mocked(listMailboxMessages).mockResolvedValue(mailbox);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('shows unread context and opens a sent message using the resolved mailbox path', async () => {
  await mount();

  expect(
    tree.root
      .findAll(
        node =>
          node.props.accessibilityRole === 'button' &&
          typeof node.props.onPress === 'function',
      )
      .some(node => node.props.accessibilityLabel?.startsWith('Unread. Alex')),
  ).toBe(true);
  jest
    .mocked(listMailboxMessages)
    .mockResolvedValue({...mailbox, folder: '[Gmail]/Sent Mail'});
  await act(async () => press('Sent'));
  expect(listMailboxMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({folder: 'Sent', page: 1}),
  );
  const row = tree.root
    .findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )
    .find(node =>
      node.props.accessibilityLabel?.startsWith('Unread. To: Jamie'),
    )!;
  await act(async () => row.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('MailMessage', {
    uid: 42,
    folder: '[Gmail]/Sent Mail',
  });
});

it('submits search to the mailbox and starts at the first page', async () => {
  await mount();
  await act(async () =>
    tree.root
      .findAllByType(AppButton)
      .find(node => node.props.title === 'Next')!
      .props.onPress(),
  );
  expect(listMailboxMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({page: 2}),
  );
  const input = tree.root.findByProps({accessibilityLabel: 'Search mail'});
  await act(async () => input.props.onChangeText('  Alex  '));
  await act(async () => press('Search'));
  expect(listMailboxMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({search: 'Alex', page: 1}),
  );
});

it('keeps page size and custom mailbox controls available', async () => {
  await mount();
  expect(text()).not.toContain('Messages per page');
  await act(async () => press('Mailbox options'));
  const limit = tree.root
    .findAllByType(TextInput)
    .find(node => node.props.keyboardType === 'number-pad')!;
  await act(async () => limit.props.onChangeText('100'));
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.keyboardType === 'number-pad')!
      .props.onBlur(),
  );
  expect(listMailboxMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({limit: 100}),
  );
  await act(async () => press('Custom'));
  const custom = tree.root
    .findAllByType(TextInput)
    .find(node => node.props.placeholder === '[Gmail]/Sent Mail')!;
  const requestsBeforeTyping =
    jest.mocked(listMailboxMessages).mock.calls.length;
  await act(async () => custom.props.onChangeText('Archive/2026'));
  expect(listMailboxMessages).toHaveBeenCalledTimes(requestsBeforeTyping);
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.placeholder === '[Gmail]/Sent Mail')!
      .props.onBlur(),
  );
  expect(listMailboxMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({folder: 'Archive/2026', page: 1}),
  );
});

it('does not let a late inbox request overwrite the newly selected folder', async () => {
  let finish!: (value: typeof mailbox) => void;
  jest.mocked(listMailboxMessages).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  jest.mocked(listMailboxMessages).mockResolvedValue({
    ...mailbox,
    messages: [{...message, subject: 'Sent message'}],
    folder: 'Sent',
  });
  await act(async () => press('Sent'));
  await act(async () => finish(mailbox));
  expect(text()).toContain('Sent message');
  expect(text()).not.toContain('Hello there');
});
