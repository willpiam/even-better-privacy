import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  appendActivityLog,
  clearActivityLog,
  listActivityLog,
} from '../src/services/activityLog';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

beforeEach(() => {
  mockStore.clear();
});

it('preserves concurrent entries and keeps the newest 50 in order', async () => {
  await Promise.all(
    Array.from({length: 60}, (_, i) => appendActivityLog(`entry ${i}`)),
  );
  const entries = await listActivityLog();
  expect(entries).toHaveLength(50);
  expect(entries.map(entry => entry.message)).toEqual(
    Array.from({length: 50}, (_, i) => `entry ${59 - i}`),
  );
});

it('orders clear with queued writes and keeps accepting writes after a failure', async () => {
  await Promise.all([
    appendActivityLog('before'),
    clearActivityLog(),
    appendActivityLog('after'),
  ]);
  expect((await listActivityLog()).map(entry => entry.message)).toEqual([
    'after',
  ]);
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(appendActivityLog('failed')).rejects.toThrow(
    'storage unavailable',
  );
  await appendActivityLog('recovered');
  expect((await listActivityLog()).map(entry => entry.message)).toEqual([
    'recovered',
    'after',
  ]);
});
