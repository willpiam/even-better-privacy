import {
  createUnlockSessionStore,
  isSessionExpired,
  shouldLockAfterBackground,
  slidingExpiresAt,
  timeoutMsFromMinutes,
} from '../src/services/unlockSessionLogic';

const MINUTE = 60_000;

describe('unlockSessionLogic', () => {
  test('default idle timeout is 15 minutes', () => {
    expect(timeoutMsFromMinutes(undefined)).toBe(15 * MINUTE);
    expect(timeoutMsFromMinutes(15)).toBe(15 * MINUTE);
    expect(timeoutMsFromMinutes(5)).toBe(5 * MINUTE);
    expect(timeoutMsFromMinutes(60)).toBe(60 * MINUTE);
    expect(timeoutMsFromMinutes(7)).toBe(15 * MINUTE);
  });

  test('sliding expiry extends the deadline and then locks', () => {
    let now = 1_000;
    const store = createUnlockSessionStore(() => now);
    const key = new Uint8Array([9, 8, 7]);
    const salt = new Uint8Array([1, 2, 3]);
    store.unlock('alice', {key, salt}, 15 * MINUTE);

    expect(store.inspect('alice').state).toBe('live');
    expect(isSessionExpired(slidingExpiresAt(now, 15 * MINUTE), now + 15 * MINUTE)).toBe(
      true,
    );

    now += 10 * MINUTE;
    expect(store.touch('alice')).toBe(true);
    const live = store.inspect('alice');
    expect(live.state).toBe('live');
    if (live.state === 'live') {
      expect(live.expiresAt).toBe(now + 15 * MINUTE);
      expect(live.salt).toEqual(salt);
    }

    now += 15 * MINUTE;
    expect(store.inspect('alice').state).toBe('expired');
    expect(store.touch('alice')).toBe(false);
  });

  test('lock and lockAll wipe the cached key', () => {
    const store = createUnlockSessionStore(() => 0);
    const alice = new Uint8Array([1, 1]);
    const bob = new Uint8Array([2, 2]);
    store.unlock('alice', {key: alice, salt: new Uint8Array([4])}, MINUTE);
    store.unlock('bob', {key: bob, salt: new Uint8Array([5])}, MINUTE);
    expect(store.lock('alice')).toBe(true);
    expect(alice[0]).toBe(0);
    expect(store.inspect('alice').state).toBe('missing');
    expect(store.lockAll()).toEqual(['bob']);
    expect(bob[0]).toBe(0);
    expect(store.names()).toEqual([]);
  });

  test('background lock uses the idle timeout', () => {
    expect(shouldLockAfterBackground(14 * MINUTE, 15 * MINUTE)).toBe(false);
    expect(shouldLockAfterBackground(15 * MINUTE, 15 * MINUTE)).toBe(true);
    expect(shouldLockAfterBackground(60 * MINUTE, 5 * MINUTE)).toBe(true);
  });

  test('applyTimeout slides live sessions and reports expired ones', () => {
    let now = 0;
    const store = createUnlockSessionStore(() => now);
    store.unlock('fresh', {key: new Uint8Array([1]), salt: new Uint8Array([2])}, 15 * MINUTE);
    store.unlock('old', {key: new Uint8Array([3]), salt: new Uint8Array([4])}, 5 * MINUTE);
    now = 5 * MINUTE;
    const evicted = store.applyTimeout(60 * MINUTE);
    expect(evicted).toEqual(['old']);
    const fresh = store.inspect('fresh');
    expect(fresh.state).toBe('live');
    if (fresh.state === 'live') {
      expect(fresh.timeoutMs).toBe(60 * MINUTE);
      expect(fresh.expiresAt).toBe(now + 60 * MINUTE);
    }
  });
});
