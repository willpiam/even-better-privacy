import AsyncStorage from '@react-native-async-storage/async-storage';
import {getMailTestMode, setMailTestMode} from '../src/services/settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => 'true'),
  setItem: jest.fn(async () => {}),
}));

const originalDev = __DEV__;
afterEach(() => {
  Object.assign(globalThis, {__DEV__: originalDev});
  jest.clearAllMocks();
});

it('ignores a saved test-mail preference in release builds', async () => {
  Object.assign(globalThis, {__DEV__: false});
  expect(await getMailTestMode()).toBe(false);
  await setMailTestMode(true);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('still lets development builds use test addresses', async () => {
  Object.assign(globalThis, {__DEV__: true});
  expect(await getMailTestMode()).toBe(true);
  await setMailTestMode(false);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'ebp.mail.testMode',
    'false',
  );
});
