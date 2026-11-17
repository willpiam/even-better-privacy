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

it.each([false, true])(
  'persists the test-mail preference with __DEV__=%s',
  async dev => {
    Object.assign(globalThis, {__DEV__: dev});
    expect(await getMailTestMode()).toBe(true);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('ebp.mail.testMode');
    await setMailTestMode(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'ebp.mail.testMode',
      'false',
    );
  },
);

it('defaults test mail to off', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
  expect(await getMailTestMode()).toBe(false);
});
