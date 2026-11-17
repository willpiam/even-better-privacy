import React from 'react';
import {Alert, Switch} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import SettingsScreen from '../src/screens/SettingsScreen';
import {getMailTestMode, setMailTestMode} from '../src/services/settings';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/services/settings', () => ({
  AUTO_LOCK_MINUTE_OPTIONS: [5, 15],
  getServerUrl: async () => 'https://keys.example',
  getEnforcePasswordPolicy: async () => true,
  getAutoLockMinutes: async () => 15,
  getMailRenderHtml: async () => false,
  getMailIncludePublicKeys: async () => true,
  getMailTestMode: jest.fn(async () => false),
  setMailTestMode: jest.fn(async () => {}),
}));
jest.mock('../src/services/unlockSession', () => ({
  installIdentityUnlockWatcher: jest.fn(),
}));

const originalDev = __DEV__;
let tree: renderer.ReactTestRenderer;
let alert: jest.SpyInstance;
const testSwitch = () =>
  tree.root
    .findAllByType(Switch)
    .find(node => node.props.testID === 'settings-mail-test-mode')!;
async function mount() {
  await act(async () => {
    tree = renderer.create(
      <SettingsScreen
        navigation={{} as never}
        route={{key: 'settings', name: 'Settings'}}
      />,
    );
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, {__DEV__: false});
  jest.mocked(getMailTestMode).mockResolvedValue(false);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  alert.mockRestore();
  Object.assign(globalThis, {__DEV__: originalDev});
});

it('shows the release setting but only enables it after explicit consent', async () => {
  await mount();
  await act(async () => testSwitch().props.onValueChange(true));
  expect(alert).toHaveBeenCalledWith(
    'Enable test emails and payments?',
    expect.stringContaining('Never send real cryptocurrency or mainnet funds'),
    expect.any(Array),
    {cancelable: true},
  );
  expect(testSwitch().props.value).toBe(false);
  expect(setMailTestMode).not.toHaveBeenCalled();
  const agree = alert.mock.calls[0][2][1];
  await act(async () => agree.onPress());
  expect(setMailTestMode).toHaveBeenCalledWith(true);
  expect(testSwitch().props.value).toBe(true);
});

it('leaves test mail disabled when the warning is cancelled or dismissed', async () => {
  await mount();
  await act(async () => testSwitch().props.onValueChange(true));
  const cancel = alert.mock.calls[0][2][0];
  expect(cancel.style).toBe('cancel');
  await act(async () => cancel.onPress?.());
  expect(setMailTestMode).not.toHaveBeenCalled();
  expect(testSwitch().props.value).toBe(false);
  // Dismissal has no confirmation callback and likewise cannot save the setting.
  await act(async () => testSwitch().props.onValueChange(true));
  expect(setMailTestMode).not.toHaveBeenCalled();
  expect(testSwitch().props.value).toBe(false);
});

it('allows disabling without a warning', async () => {
  jest.mocked(getMailTestMode).mockResolvedValue(true);
  await mount();
  await act(async () => testSwitch().props.onValueChange(false));
  expect(alert).not.toHaveBeenCalled();
  expect(setMailTestMode).toHaveBeenCalledWith(false);
  expect(testSwitch().props.value).toBe(false);
});

it('does not enable the switch if saving consent fails', async () => {
  jest
    .mocked(setMailTestMode)
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  await mount();
  await act(async () => testSwitch().props.onValueChange(true));
  await act(async () => alert.mock.calls[0][2][1].onPress());
  expect(testSwitch().props.value).toBe(false);
});
