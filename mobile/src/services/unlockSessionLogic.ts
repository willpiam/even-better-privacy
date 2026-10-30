/**
 * Pure identity-unlock expiry rules. No React Native, so Jest can drive the clock.
 */

import {
  clampAutoLockMinutes,
  DEFAULT_AUTO_LOCK_MINUTES,
} from './settingsLogic';

export {clampAutoLockMinutes, DEFAULT_AUTO_LOCK_MINUTES};

export function timeoutMsFromMinutes(minutes: unknown): number {
  return clampAutoLockMinutes(minutes) * 60_000;
}

export function slidingExpiresAt(now: number, timeoutMs: number): number {
  return now + timeoutMs;
}

/** Idle expiry is inclusive: a session at exactly expiresAt is locked. */
export function isSessionExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

/**
 * Lock when the app has been out of the foreground at least as long as the
 * idle timeout. Shorter trips to the background keep the session.
 */
export function shouldLockAfterBackground(
  elapsedMs: number,
  timeoutMs: number,
): boolean {
  return elapsedMs >= timeoutMs;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export type UnlockMaterial = {
  key: Uint8Array;
  salt: Uint8Array;
};

type SessionRecord = {
  key: Uint8Array;
  salt: Uint8Array;
  timeoutMs: number;
  expiresAt: number;
};

export type SessionView =
  | {state: 'missing'}
  | {state: 'expired'}
  | {
      state: 'live';
      key: Uint8Array;
      salt: Uint8Array;
      timeoutMs: number;
      expiresAt: number;
    };

export type UnlockSessionStore = {
  unlock(name: string, material: UnlockMaterial, timeoutMs: number, now?: number): void;
  touch(name: string, now?: number): boolean;
  inspect(name: string, now?: number): SessionView;
  lock(name: string): boolean;
  lockAll(): string[];
  names(): string[];
  /** Update the idle window of live sessions and drop ones already expired. */
  applyTimeout(timeoutMs: number, now?: number): string[];
};

export function createUnlockSessionStore(
  now: () => number = Date.now,
): UnlockSessionStore {
  const sessions = new Map<string, SessionRecord>();

  const wipe = (session: SessionRecord) => {
    session.key.fill(0);
  };

  return {
    unlock(name, material, timeoutMs, at = now()) {
      const previous = sessions.get(name);
      if (previous && previous.key !== material.key) {
        wipe(previous);
      }
      const ms = timeoutMs > 0 ? timeoutMs : timeoutMsFromMinutes(DEFAULT_AUTO_LOCK_MINUTES);
      sessions.set(name, {
        key: material.key,
        salt: material.salt.slice(),
        timeoutMs: ms,
        expiresAt: slidingExpiresAt(at, ms),
      });
    },
    touch(name, at = now()) {
      const session = sessions.get(name);
      if (!session || isSessionExpired(session.expiresAt, at)) {
        return false;
      }
      session.expiresAt = slidingExpiresAt(at, session.timeoutMs);
      return true;
    },
    inspect(name, at = now()) {
      const session = sessions.get(name);
      if (!session) {
        return {state: 'missing'};
      }
      if (isSessionExpired(session.expiresAt, at)) {
        return {state: 'expired'};
      }
      return {
        state: 'live',
        key: session.key,
        salt: session.salt,
        timeoutMs: session.timeoutMs,
        expiresAt: session.expiresAt,
      };
    },
    lock(name) {
      const session = sessions.get(name);
      if (!session) {
        return false;
      }
      wipe(session);
      sessions.delete(name);
      return true;
    },
    lockAll() {
      const names = [...sessions.keys()];
      for (const name of names) {
        const session = sessions.get(name);
        if (session) {
          wipe(session);
        }
        sessions.delete(name);
      }
      return names;
    },
    names() {
      return [...sessions.keys()];
    },
    applyTimeout(timeoutMs, at = now()) {
      const evicted: string[] = [];
      const ms = timeoutMs > 0 ? timeoutMs : timeoutMsFromMinutes(DEFAULT_AUTO_LOCK_MINUTES);
      for (const [name, session] of [...sessions]) {
        if (isSessionExpired(session.expiresAt, at)) {
          wipe(session);
          sessions.delete(name);
          evicted.push(name);
          continue;
        }
        session.timeoutMs = ms;
        session.expiresAt = slidingExpiresAt(at, ms);
      }
      return evicted;
    },
  };
}
