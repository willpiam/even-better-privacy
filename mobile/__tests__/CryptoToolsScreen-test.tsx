import React from 'react';
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import renderer, {act} from 'react-test-renderer';
import AppButton from '../src/components/AppButton';
import TextField from '../src/components/TextField';
import StatusBanner from '../src/components/StatusBanner';
import {useIdentityUnlock} from '../src/hooks/useIdentityUnlock';
import SignMessageScreen from '../src/screens/crypto/SignMessageScreen';
import VerifyMessageScreen from '../src/screens/crypto/VerifyMessageScreen';
import DecryptFileScreen from '../src/screens/crypto/DecryptFileScreen';
import {ToolResult} from '../src/screens/crypto/ToolResult';
import {signMessage, verifyMessage} from '../src/services/signVerify';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) =>
    require('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn(),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  errorCodes: {OPERATION_CANCELED: 'CANCELED'},
  isErrorWithCode: (error: {code?: string}) => !!error.code,
}));
jest.mock('react-native-fs', () => ({readFile: jest.fn(), unlink: jest.fn()}));
jest.mock('react-native-share', () => ({open: jest.fn()}));
jest.mock('../src/ebpCore', () => ({
  parseEbpPayloadInput: jest.requireActual('../../core/PayloadInput')
    .parseEbpPayloadInput,
}));
jest.mock('../src/services/contacts', () => ({listContacts: async () => []}));
jest.mock('../src/services/storage', () => ({
  getCurrentIdentity: async () => 'Personal',
  getCurrentIdentityRequired: async () => 'Personal',
}));
jest.mock('../src/services/encryptDecrypt', () => ({decryptFile: jest.fn()}));
jest.mock('../src/services/signVerify', () => ({
  signMessage: jest.fn(),
  verifyMessage: jest.fn(),
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: jest.fn(),
}));

const signedPayload = {
  type: 'ebp-signed-message',
  version: 2,
  message: 'Hello',
};
const unlock = jest.fn(async () => 'Personal');
let tree: renderer.ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useIdentityUnlock).mockReturnValue({
    ensureUnlocked: unlock,
    unlockPrompt: null as never,
  });
  jest.mocked(RNFS.unlink).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

async function mount(screen: React.ReactElement) {
  await act(async () => {
    tree = renderer.create(screen);
  });
}

function button(title: string) {
  return tree.root
    .findAllByType(AppButton)
    .find(node => node.props.title === title)!;
}

async function press(title: string) {
  await act(async () => {
    await button(title).props.onPress();
  });
}

async function enter(label: string, text: string) {
  await act(async () => {
    tree.root
      .findAllByType(TextField)
      .find(node => node.props.label === label)!
      .props.onChangeText(text);
  });
}

it('copies a signed message only on request and removes its output after an edit', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find(entry => entry.text === 'Sign')?.onPress?.();
  });
  jest.mocked(signMessage).mockResolvedValue(signedPayload);

  await mount(<SignMessageScreen />);
  expect(button('Sign message').props.disabled).toBe(true);
  await enter('Message', 'Hello');
  await press('Sign message');

  expect(tree.root.findByType(ToolResult).props.title).toBe('Message signed');
  expect(Clipboard.setString).not.toHaveBeenCalled();
  await press('Copy payload');
  expect(Clipboard.setString).toHaveBeenCalledWith(
    JSON.stringify(signedPayload, null, 2),
  );
  expect(button('Copied')).toBeDefined();

  await enter('Message', 'Different message');
  expect(tree.root.findAllByType(ToolResult)).toHaveLength(0);
  expect(button('Copy payload')).toBeUndefined();
});

it('presents a failed verification as an invalid signature', async () => {
  jest
    .mocked(Clipboard.getString)
    .mockResolvedValue(JSON.stringify(signedPayload));
  jest.mocked(verifyMessage).mockResolvedValue({verified: false});

  await mount(<VerifyMessageScreen />);
  await press('Paste');
  await press('Verify message');

  expect(tree.root.findByType(ToolResult).props).toMatchObject({
    title: 'Invalid signature',
    tone: 'error',
  });
});

it('keeps a pasted payload after picker cancellation and reports file copy failures', async () => {
  jest.mocked(Clipboard.getString).mockResolvedValue('pasted payload');
  jest.mocked(pick).mockRejectedValueOnce({code: 'CANCELED'});
  jest.mocked(pick).mockResolvedValueOnce([{uri: 'content://file'}] as never);
  jest
    .mocked(keepLocalCopy)
    .mockResolvedValueOnce([
      {status: 'error', copyError: 'Could not access the file'},
    ] as never);

  await mount(<DecryptFileScreen />);
  await press('Paste');
  await press('Import file');
  expect(tree.root.findByType(TextField).props.value).toBe('pasted payload');
  expect(
    tree.root.findAllByType(StatusBanner).map(node => node.props.kind),
  ).not.toContain('error');

  await press('Import file');
  expect(tree.root.findByType(StatusBanner).props.message).toMatch(
    /Could not open this file/,
  );
  expect(tree.root.findByType(TextField).props.value).toBe('pasted payload');
});

it('checks that an imported file is an encrypted file payload before unlocking', async () => {
  jest
    .mocked(pick)
    .mockResolvedValue([
      {uri: 'content://file', name: 'message.json'},
    ] as never);
  jest
    .mocked(keepLocalCopy)
    .mockResolvedValue([
      {status: 'success', localUri: 'file:///cache/input'},
    ] as never);
  jest.mocked(RNFS.readFile).mockResolvedValue(JSON.stringify(signedPayload));

  await mount(<DecryptFileScreen />);
  await press('Import file');
  expect(tree.root.findAllByType(TextField)).toHaveLength(0);

  await press('Decrypt file');
  expect(tree.root.findByType(StatusBanner).props.message).toBe(
    'Provide an encrypted file payload.',
  );
  expect(unlock).not.toHaveBeenCalled();
  expect(RNFS.unlink).toHaveBeenCalledWith('/cache/input');
});
