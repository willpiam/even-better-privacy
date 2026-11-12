jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@noble/hashes/utils.js', () => ({
  randomBytes: jest.fn(
    (size: number) => new Uint8Array(require('crypto').randomBytes(size)),
  ),
}));
jest.mock('../src/services/settings', () => ({
  getServerUrl: jest.fn(async () => 'https://keyserver.example.test'),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {randomBytes} from '@noble/hashes/utils.js';
import {
  completeMailOAuthFromUrl,
  MAIL_OAUTH_PENDING_TTL_MS,
  startMailOAuth,
} from '../src/services/mail/oauth';
import {MAIL_OAUTH_REDIRECT_URI} from '../src/services/mail/types';

const pendingKey = 'ebp.mail.oauth.pending';
const now = 1_800_000_000_000;
const originalFetch = globalThis.fetch;
const tokenResponse = {
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'me@example.test',
  tokenExpiry: now + 3600_000,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => tokenResponse,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

test('OAuth state uses 32 cryptographically random bytes and is saved only after configuration is valid', async () => {
  await expect(startMailOAuth('gmail')).rejects.toThrow(
    'OAuth client ID required',
  );
  expect(await AsyncStorage.getItem(pendingKey)).toBeNull();

  const weakRandom = jest.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('insecure randomness');
  });
  const first = await startMailOAuth('gmail', 'client-id');
  const second = await startMailOAuth('gmail', 'client-id');
  weakRandom.mockRestore();
  expect(randomBytes).toHaveBeenCalledWith(32);
  expect(first.state).toMatch(/^[0-9a-f]{64}$/);
  expect(second.state).not.toBe(first.state);
  expect(new URL(second.authUrl).searchParams.get('state')).toBe(second.state);
  expect(JSON.parse((await AsyncStorage.getItem(pendingKey))!)).toEqual({
    state: second.state,
    provider: 'gmail',
    createdAt: now,
  });
});

test.each([
  ['expired', now - MAIL_OAUTH_PENDING_TTL_MS],
  ['old', now - 24 * 60 * 60 * 1000],
  ['future', now + 1],
  ['missing timestamp', undefined],
  ['invalid timestamp', 'invalid'],
])(
  'rejects and clears %s OAuth state without exchanging tokens',
  async (_label, createdAt) => {
    await AsyncStorage.setItem(
      pendingKey,
      JSON.stringify({state: 'state', provider: 'gmail', createdAt}),
    );
    await expect(
      completeMailOAuthFromUrl(
        `${MAIL_OAUTH_REDIRECT_URI}?code=code&state=state`,
      ),
    ).rejects.toThrow('OAuth session expired');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(pendingKey)).toBeNull();
  },
);

test('a state mismatch does not exchange tokens or consume the current session', async () => {
  const {state} = await startMailOAuth('gmail', 'client-id');
  await expect(
    completeMailOAuthFromUrl(
      `${MAIL_OAUTH_REDIRECT_URI}?code=code&state=wrong`,
    ),
  ).rejects.toThrow('OAuth state mismatch');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(pendingKey))!).state).toBe(
    state,
  );
});

test('a fresh matching state is exchanged once and cannot be replayed', async () => {
  const {state} = await startMailOAuth('gmail', 'client-id');
  jest.spyOn(Date, 'now').mockReturnValue(now + MAIL_OAUTH_PENDING_TTL_MS - 1);
  const url = `${MAIL_OAUTH_REDIRECT_URI}?code=code&state=${state}`;
  expect(await completeMailOAuthFromUrl(url)).toEqual({
    provider: 'gmail',
    ...tokenResponse,
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(pendingKey)).toBeNull();
  await expect(completeMailOAuthFromUrl(url)).rejects.toThrow(
    'No pending OAuth session',
  );
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
