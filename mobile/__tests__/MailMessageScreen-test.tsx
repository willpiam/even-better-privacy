import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

jest.mock('../src/services/storage', () => ({
  getCurrentIdentityRequired: jest.fn(),
}));
jest.mock('../src/services/mail/accountStore', () => ({
  resolveSelectedAccount: jest.fn(),
}));
jest.mock('../src/services/mail/imap', () => ({fetchMessageDetail: jest.fn()}));
jest.mock('../src/services/mail/ebpMail', () => ({decryptMailBody: jest.fn()}));
jest.mock('../src/services/settings', () => ({getMailRenderHtml: jest.fn()}));
jest.mock('../src/services/unlockSession', () => ({isUnlocked: jest.fn()}));
jest.mock('../src/services/contacts', () => ({
  listContacts: jest.fn(),
  loadContact: jest.fn(),
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('react-native-webview', () => ({WebView: 'WebView'}));
jest.mock('../src/screens/mail/MailAppearance', () => ({
  ...jest.requireActual('../src/screens/mail/MailAppearance'),
  MailIcon: () => null,
}));
// The badge's domain rules are covered by mailAuthenticity-test; keep its navigation real here.
jest.mock('../src/components/AuthenticityBadge', () => {
  const {Pressable} = require('react-native');
  return ({
    summary,
    onPress,
  }: {
    summary: {verifyStatus: string};
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityLabel={`Authenticity: ${summary.verifyStatus}`}
      onPress={onPress}
    />
  );
});

import MailMessageScreen from '../src/screens/mail/MailMessageScreen';
import AppButton from '../src/components/AppButton';
import {getCurrentIdentityRequired} from '../src/services/storage';
import {resolveSelectedAccount} from '../src/services/mail/accountStore';
import {fetchMessageDetail} from '../src/services/mail/imap';
import {
  decryptMailBody,
  type MailAuthenticitySummary,
} from '../src/services/mail/ebpMail';
import {getMailRenderHtml} from '../src/services/settings';
import {isUnlocked} from '../src/services/unlockSession';
import {useIdentityUnlock} from '../src/hooks/useIdentityUnlock';

type Props = React.ComponentProps<typeof MailMessageScreen>;
const navigation = {navigate: jest.fn()} as unknown as Props['navigation'];
const route = (uid = 42, folder = 'INBOX'): Props['route'] => ({
  key: 'reader',
  name: 'MailMessage',
  params: {uid, folder},
});
const ensureUnlocked = jest.fn();
const encryptedDetail = {
  uid: 42,
  subject: 'A little breathing room',
  from: 'Alex <alex@example.com>',
  to: 'me@example.com',
  date: 'Tue, 10 Nov 2026 12:00:00 +0000',
  bodyText: 'SECRET ARMOR',
  bodyHtml: '',
  rawSource: 'Message-ID: <42@example.com>\r\n\r\nSECRET ARMOR',
  ebpPayload: '{}',
};
const result: MailAuthenticitySummary = {
  plaintext: 'A decrypted conversation.',
  verified: true,
  verifyStatus: 'valid',
  signerFingerprint: 'abc',
  contactName: 'Alex',
  isKnownContact: true,
  signerEmail: 'alex@example.com',
  opaqueEmailMatched: false,
  matchedEmailPath: 'email',
  signerEmailVerified: true,
  signerMatchesSenderEmail: true,
  serverIdentityMatch: true,
  messageFrom: encryptedDetail.from,
};
let tree: renderer.ReactTestRenderer;
const text = () =>
  tree.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
const buttons = (title: string) =>
  tree.root.findAllByType(AppButton).filter(node => node.props.title === title);
async function mount(messageRoute = route()) {
  await act(async () => {
    tree = renderer.create(
      <MailMessageScreen navigation={navigation} route={messageRoute} />,
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentIdentityRequired).mockResolvedValue('Personal');
  jest
    .mocked(resolveSelectedAccount)
    .mockResolvedValue({account: {config: {}}, secrets: {}} as never);
  jest.mocked(fetchMessageDetail).mockResolvedValue(encryptedDetail);
  jest.mocked(getMailRenderHtml).mockResolvedValue(false);
  jest.mocked(isUnlocked).mockReturnValue(true);
  jest.mocked(decryptMailBody).mockResolvedValue(result);
  ensureUnlocked.mockResolvedValue('Personal');
  jest
    .mocked(useIdentityUnlock)
    .mockReturnValue({ensureUnlocked, unlockPrompt: <></>});
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('automatically decrypts using the current unlocked identity without a prompt', async () => {
  await mount(route(42, 'Sent'));
  expect(isUnlocked).toHaveBeenCalledWith('Personal');
  expect(decryptMailBody).toHaveBeenCalledTimes(1);
  expect(decryptMailBody).toHaveBeenCalledWith({
    identityName: 'Personal',
    uid: 42,
    folder: 'Sent',
  });
  expect(ensureUnlocked).not.toHaveBeenCalled();
  expect(text()).toContain(result.plaintext);
  expect(text()).not.toContain('SECRET ARMOR');
  expect(buttons('Decrypt')).toHaveLength(0);
  expect(buttons('Reply')).toHaveLength(1);
});

it('keeps a locked identity manual and decrypts after the unlock action', async () => {
  jest.mocked(isUnlocked).mockReturnValue(false);
  await mount();
  expect(decryptMailBody).not.toHaveBeenCalled();
  expect(ensureUnlocked).not.toHaveBeenCalled();
  expect(buttons('Reply')).toHaveLength(0);
  expect(text()).not.toContain('SECRET ARMOR');
  await act(async () => buttons('Decrypt')[0].props.onPress());
  expect(ensureUnlocked).toHaveBeenCalledTimes(1);
  expect(text()).toContain(result.plaintext);
});

it('leaves a cancelled unlock available to try again', async () => {
  jest.mocked(isUnlocked).mockReturnValue(false);
  ensureUnlocked.mockResolvedValueOnce(null);
  await mount();
  await act(async () => buttons('Decrypt')[0].props.onPress());
  expect(decryptMailBody).not.toHaveBeenCalled();
  expect(buttons('Decrypt')).toHaveLength(1);
  expect(buttons('Reply')).toHaveLength(0);
});

it('shows automatic-decryption errors and allows a deliberate retry', async () => {
  jest
    .mocked(decryptMailBody)
    .mockRejectedValueOnce(new Error('Identity session expired'));
  await mount();
  expect(text()).toContain('Identity session expired');
  expect(buttons('Reply')).toHaveLength(0);
  await act(async () => buttons('Retry decryption')[0].props.onPress());
  expect(decryptMailBody).toHaveBeenCalledTimes(2);
  expect(text()).toContain(result.plaintext);
  expect(text()).not.toContain('Identity session expired');
});

it('does not decrypt ordinary mail and keeps sandboxed HTML available', async () => {
  jest
    .mocked(fetchMessageDetail)
    .mockResolvedValue({
      ...encryptedDetail,
      ebpPayload: null,
      bodyHtml: '<p>Hello</p>',
    });
  jest.mocked(getMailRenderHtml).mockResolvedValue(true);
  await mount();
  expect(decryptMailBody).not.toHaveBeenCalled();
  expect(
    tree.root.findAllByProps({testID: 'mail-html-webview'}),
  ).not.toHaveLength(0);
  expect(buttons('Reply')).toHaveLength(1);
});

it.each([
  ['unsigned', null],
  ['invalid', false],
] as const)(
  'retains the %s authenticity state after automatic decryption',
  async (verifyStatus, verified) => {
    jest
      .mocked(decryptMailBody)
      .mockResolvedValue({...result, verifyStatus, verified});
    await mount();
    expect(
      tree.root.findAllByProps({
        accessibilityLabel: `Authenticity: ${verifyStatus}`,
      }),
    ).not.toHaveLength(0);
    expect(text()).toContain(result.plaintext);
  },
);

it('treats successfully decrypted empty plaintext as readable', async () => {
  jest.mocked(decryptMailBody).mockResolvedValue({...result, plaintext: ''});
  await mount();
  expect(buttons('Decrypt')).toHaveLength(0);
  expect(buttons('Reply')).toHaveLength(1);
  expect(text()).not.toContain('SECRET ARMOR');
});

it('does not replace a newly opened message with an earlier decryption result', async () => {
  let finish!: (value: MailAuthenticitySummary) => void;
  jest.mocked(decryptMailBody).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  expect(text()).toContain('Decrypting message…');
  jest
    .mocked(fetchMessageDetail)
    .mockResolvedValue({
      ...encryptedDetail,
      uid: 43,
      subject: 'New message',
      bodyText: 'Plain second message',
      ebpPayload: null,
    });
  await act(async () =>
    tree.update(
      <MailMessageScreen navigation={navigation} route={route(43)} />,
    ),
  );
  await act(async () => finish(result));
  expect(text()).toContain('Plain second message');
  expect(text()).not.toContain(result.plaintext);
});

it('ignores a fetch completed after leaving the reader', async () => {
  let finish!: (value: typeof encryptedDetail) => void;
  jest.mocked(fetchMessageDetail).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  await act(async () => tree.unmount());
  await act(async () => finish(encryptedDetail));
  expect(decryptMailBody).not.toHaveBeenCalled();
});
