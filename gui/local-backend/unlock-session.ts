import { AES, DecryptionAuthError } from "../../core/AES.ts";
import { Identity } from "../../core/Identity.ts";
import type { CLIContext } from "../../cli/utils.ts";
import { HttpError, STATUS } from "./http.ts";
import {
  loadIdentity,
  readIdentityStorage,
  saveIdentity,
  saveIdentityWithKey,
  toIdentityDecryptHttpError,
} from "./identity.ts";
import {
  clearMailSecrets,
  tryUnlockMailSecretsWithIdentityPassword,
} from "./mail-account.ts";

export const DEFAULT_UNLOCK_TIMEOUT_MIN = 15;
export const MIN_UNLOCK_TIMEOUT_MIN = 1;
export const MAX_UNLOCK_TIMEOUT_MIN = 24 * 60;
export const IDENTITY_LOCKED_ERROR = "identity locked";
export const IDENTITY_LOCKED_CODE = "identity_locked";

/** Argon2id v3+ ciphertexts share key derivation, so a cached key can re-save. */
const MIN_SESSION_AES_VERSION = 3;

interface UnlockSession {
  key: Uint8Array;
  salt: Uint8Array;
  identityDir: string;
  timeoutMs: number;
  expiresAt: number;
}

export interface UnlockStatus {
  identity: string;
  unlocked: boolean;
  expiresAt: number | null;
  remainingMs: number;
  timeoutMinutes: number;
}

const sessions = new Map<string, UnlockSession>();
let clock: () => number = () => Date.now();
let sweepTimer: ReturnType<typeof setInterval> | undefined;

export function setUnlockClockForTest(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

function sessionId(ctx: CLIContext): string {
  return `${ctx.identityDir}/${ctx.currentIdentity}`;
}

export function clampUnlockTimeoutMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_UNLOCK_TIMEOUT_MIN;
  return Math.min(
    MAX_UNLOCK_TIMEOUT_MIN,
    Math.max(MIN_UNLOCK_TIMEOUT_MIN, Math.round(n)),
  );
}

export function identityLockedError(): HttpError {
  return new HttpError(STATUS.Unauthorized, IDENTITY_LOCKED_ERROR, {
    code: IDENTITY_LOCKED_CODE,
  });
}

function dropSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.key.fill(0);
  sessions.delete(id);
  const dirStillUnlocked = [...sessions.values()].some((s) =>
    s.identityDir === session.identityDir
  );
  if (!dirStillUnlocked) clearMailSecrets(session.identityDir);
}

export function sweepExpiredSessions(): number {
  const now = clock();
  let dropped = 0;
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      dropSession(id);
      dropped += 1;
    }
  }
  return dropped;
}

/** Periodically drop idle sessions even when no request arrives. */
export function startUnlockSweeper(intervalMs = 30_000): void {
  if (sweepTimer !== undefined) return;
  const timer = setInterval(sweepExpiredSessions, intervalMs);
  Deno.unrefTimer(timer);
  sweepTimer = timer;
}

function liveSession(ctx: CLIContext): UnlockSession | null {
  sweepExpiredSessions();
  return sessions.get(sessionId(ctx)) ?? null;
}

function touch(session: UnlockSession): void {
  session.expiresAt = clock() + session.timeoutMs;
}

function readEncryptedHeader(
  storageData: string,
): { version: number; salt: Uint8Array } {
  let encrypted: unknown;
  try {
    encrypted = (JSON.parse(storageData) as { encrypted?: unknown }).encrypted;
  } catch {
    throw new HttpError(STATUS.BadRequest, "invalid identity file");
  }
  if (typeof encrypted !== "string") {
    throw new HttpError(
      STATUS.BadRequest,
      "invalid identity file: missing encrypted private identity data",
    );
  }
  try {
    return AES.readHeader(encrypted);
  } catch (e) {
    throw toIdentityDecryptHttpError(e);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function decryptWithKey(storageData: string, key: Uint8Array): Identity {
  try {
    return Identity.fromStorageFormatWithKey(storageData, key);
  } catch (e) {
    throw toIdentityDecryptHttpError(e);
  }
}

/**
 * Derive and cache the storage key for the identity (one Argon2id run).
 * Legacy PBKDF2 files are upgraded first so the cached key matches the file.
 */
export async function unlockIdentity(
  ctx: CLIContext,
  password: string,
  timeoutMinutes?: unknown,
): Promise<{ identity: Identity; status: UnlockStatus; mailUnlocked: boolean }> {
  if (!password) {
    throw new HttpError(STATUS.BadRequest, "password is required");
  }
  let storageData = await readIdentityStorage(ctx);
  let header = readEncryptedHeader(storageData);
  if (header.version < MIN_SESSION_AES_VERSION) {
    await loadIdentity(ctx, password);
    storageData = await readIdentityStorage(ctx);
    header = readEncryptedHeader(storageData);
    if (header.version < MIN_SESSION_AES_VERSION) {
      throw new HttpError(
        STATUS.BadRequest,
        "identity storage could not be upgraded for session unlock",
      );
    }
  }
  const key = AES.deriveKeyForStorage(password, header.salt, header.version);
  const identity = decryptWithKey(storageData, key);
  if (Identity.needsPrivateKeyTypeStorageUpgrade(identity)) {
    try {
      await saveIdentityWithKey(ctx, key, header.salt, identity);
    } catch (e) {
      console.warn("failed to upgrade identity storage:", e);
    }
  }

  const id = sessionId(ctx);
  const previous = sessions.get(id);
  const timeoutMs = (timeoutMinutes === undefined && previous)
    ? previous.timeoutMs
    : clampUnlockTimeoutMinutes(timeoutMinutes) * 60_000;
  if (previous && previous.key !== key) previous.key.fill(0);
  sessions.set(id, {
    key,
    salt: header.salt,
    identityDir: ctx.identityDir,
    timeoutMs,
    expiresAt: clock() + timeoutMs,
  });
  const mailUnlocked = await tryUnlockMailSecretsWithIdentityPassword(
    ctx.identityDir,
    password,
  );
  return { identity, status: getUnlockStatus(ctx), mailUnlocked };
}

export function lockIdentity(ctx: CLIContext): boolean {
  const id = sessionId(ctx);
  const had = sessions.has(id);
  dropSession(id);
  clearMailSecrets(ctx.identityDir);
  return had;
}

export function lockAll(): number {
  const count = sessions.size;
  const dirs = new Set<string>();
  for (const [id, session] of [...sessions]) {
    dirs.add(session.identityDir);
    dropSession(id);
  }
  for (const dir of dirs) clearMailSecrets(dir);
  return count;
}

export function getUnlockStatus(ctx: CLIContext): UnlockStatus {
  const session = liveSession(ctx);
  const now = clock();
  return {
    identity: ctx.currentIdentity,
    unlocked: Boolean(session),
    expiresAt: session?.expiresAt ?? null,
    remainingMs: session ? Math.max(0, session.expiresAt - now) : 0,
    timeoutMinutes: session
      ? Math.round(session.timeoutMs / 60_000)
      : DEFAULT_UNLOCK_TIMEOUT_MIN,
  };
}

/** Change the idle timeout of a live session without re-entering the password. */
export function setUnlockTimeout(
  ctx: CLIContext,
  timeoutMinutes: unknown,
): UnlockStatus {
  const session = liveSession(ctx);
  if (session) {
    session.timeoutMs = clampUnlockTimeoutMinutes(timeoutMinutes) * 60_000;
    touch(session);
  }
  return getUnlockStatus(ctx);
}

export function isIdentityUnlocked(ctx: CLIContext): boolean {
  return liveSession(ctx) !== null;
}

/**
 * Load the private identity for a route. A supplied password unlocks (and
 * refreshes) the session; otherwise the cached key is used, or the request
 * fails with 401 `identity locked`. The file is re-read every time so detail
 * nonces and re-saves stay current, and a changed salt evicts the session.
 */
export async function loadIdentityForRequest(
  ctx: CLIContext,
  password?: string,
): Promise<Identity> {
  if (password) {
    return (await unlockIdentity(ctx, password)).identity;
  }
  const session = liveSession(ctx);
  if (!session) throw identityLockedError();
  const id = sessionId(ctx);
  const storageData = await readIdentityStorage(ctx);
  const header = readEncryptedHeader(storageData);
  if (!sameBytes(header.salt, session.salt)) {
    dropSession(id);
    throw identityLockedError();
  }
  let identity: Identity;
  try {
    identity = Identity.fromStorageFormatWithKey(storageData, session.key);
  } catch (e) {
    dropSession(id);
    if (e instanceof DecryptionAuthError) {
      throw identityLockedError();
    }
    throw toIdentityDecryptHttpError(e);
  }
  touch(session);
  return identity;
}

/** Persist identity changes using the password if given, else the session key. */
export async function saveIdentityForRequest(
  ctx: CLIContext,
  password: string | undefined,
  identity: Identity,
): Promise<void> {
  const session = liveSession(ctx);
  if (session) {
    await saveIdentityWithKey(ctx, session.key, session.salt, identity);
    touch(session);
    return;
  }
  if (password) {
    await saveIdentity(ctx, password, identity);
    return;
  }
  throw identityLockedError();
}
