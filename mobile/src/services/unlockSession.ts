import {AppState, type AppStateStatus} from 'react-native';
import {getAutoLockMinutes} from './settings';
import {
  createUnlockSessionStore,
  shouldLockAfterBackground,
  timeoutMsFromMinutes,
  type UnlockMaterial,
} from './unlockSessionLogic';

export {
  clampAutoLockMinutes,
  DEFAULT_AUTO_LOCK_MINUTES,
  shouldLockAfterBackground,
  timeoutMsFromMinutes,
} from './unlockSessionLogic';

const store = createUnlockSessionStore();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let configuredTimeoutMs = timeoutMsFromMinutes(undefined);
let timeoutGeneration = 0;
let backgroundedAt: number | null = null;
let watcherInstalled = false;

function sessionName(name: string): string {
  return name.trim();
}

type IdentityLockListener = (identityName: string) => void;
const identityLockListeners = new Set<IdentityLockListener>();

/** Register a side effect for lock and idle expiry. Used to drop mail secrets. */
export function onIdentityLocked(listener: IdentityLockListener): void {
  identityLockListeners.add(listener);
}

function notifyIdentityLocked(identityName: string): void {
  for (const listener of identityLockListeners) {
    listener(identityName);
  }
}

function clearTimer(name: string): void {
  const timer = timers.get(name);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(name);
  }
}

function armTimer(name: string): void {
  clearTimer(name);
  const view = store.inspect(name);
  if (view.state !== 'live') {
    return;
  }
  const delay = Math.max(0, view.expiresAt - Date.now());
  const timer = setTimeout(() => {
    timers.delete(name);
    const current = store.inspect(name);
    if (current.state === 'expired') {
      lock(name);
      return;
    }
    if (current.state === 'live') {
      armTimer(name);
    }
  }, delay);
  timers.set(name, timer);
}

/**
 * Drop the cached key. Always clears that identity's in-memory mail secrets,
 * including when the session was already gone.
 */
export function lock(name: string): boolean {
  const normalized = sessionName(name);
  clearTimer(normalized);
  const had = store.lock(normalized);
  notifyIdentityLocked(normalized);
  return had;
}

export function lockAll(): number {
  const names = store.lockAll();
  for (const name of names) {
    clearTimer(name);
    notifyIdentityLocked(name);
  }
  return names.length;
}

function dropIfExpired(name: string): boolean {
  const view = store.inspect(name);
  if (view.state !== 'expired') {
    return false;
  }
  lock(name);
  return true;
}

/** True when a fresh session exists. Does not extend the idle timer. */
export function isUnlocked(name: string): boolean {
  const normalized = sessionName(name);
  if (dropIfExpired(normalized)) {
    return false;
  }
  return store.inspect(normalized).state === 'live';
}

/**
 * Cached storage key, or null when locked or idle-expired.
 * A hit slides the idle deadline.
 */
export function getKey(name: string): Uint8Array | null {
  return readLive(name)?.key ?? null;
}

/** Key and salt for re-reading the identity file. A hit slides idle expiry. */
export function getUnlockMaterial(name: string): UnlockMaterial | null {
  return readLive(name);
}

function readLive(name: string): UnlockMaterial | null {
  const normalized = sessionName(name);
  if (dropIfExpired(normalized)) {
    return null;
  }
  const view = store.inspect(normalized);
  if (view.state !== 'live') {
    return null;
  }
  store.touch(normalized);
  armTimer(normalized);
  return {key: view.key, salt: view.salt};
}

export async function cacheUnlockedIdentity(
  name: string,
  key: Uint8Array,
  salt: Uint8Array,
): Promise<void> {
  const generation = ++timeoutGeneration;
  const minutes = await getAutoLockMinutes();
  if (generation === timeoutGeneration) {
    configuredTimeoutMs = timeoutMsFromMinutes(minutes);
  }
  const normalized = sessionName(name);
  store.unlock(normalized, {key, salt}, configuredTimeoutMs);
  armTimer(normalized);
  installIdentityUnlockWatcher();
}

/** Apply a new idle timeout to live sessions and remember it for the next unlock. */
export function applyUnlockTimeoutMinutes(minutes: number): void {
  timeoutGeneration += 1;
  configuredTimeoutMs = timeoutMsFromMinutes(minutes);
  const evicted = store.applyTimeout(configuredTimeoutMs);
  for (const name of evicted) {
    clearTimer(name);
    notifyIdentityLocked(name);
  }
  for (const name of store.names()) {
    armTimer(name);
  }
}

function onAppState(next: AppStateStatus): void {
  if (next === 'active') {
    if (backgroundedAt === null) {
      return;
    }
    const elapsed = Date.now() - backgroundedAt;
    backgroundedAt = null;
    if (shouldLockAfterBackground(elapsed, configuredTimeoutMs)) {
      lockAll();
      return;
    }
    for (const name of store.names()) {
      dropIfExpired(name);
    }
    return;
  }
  if ((next === 'background' || next === 'inactive') && backgroundedAt === null) {
    backgroundedAt = Date.now();
  }
}

/** Lock identities that stayed backgrounded longer than the auto-lock timeout. */
export function installIdentityUnlockWatcher(): void {
  if (watcherInstalled) {
    return;
  }
  watcherInstalled = true;
  const generation = timeoutGeneration;
  AppState.addEventListener('change', onAppState);
  void getAutoLockMinutes()
    .then(minutes => {
      if (generation !== timeoutGeneration) {
        return;
      }
      configuredTimeoutMs = timeoutMsFromMinutes(minutes);
    })
    .catch(() => {
      // Keep the in-memory timeout (default 15 minutes) if settings cannot be read.
    });
}
