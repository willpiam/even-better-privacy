/**
 * Pure settings parsers (Deno/Jest-testable; no AsyncStorage).
 */

export function parseStoredBoolean(
  value: string | null,
  fallback: boolean,
): boolean {
  if (value === null) {
    return fallback;
  }
  return value === 'true';
}

/** Enforce-password-policy defaults to true when unset. */
export function parseEnforcePasswordPolicy(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  return value === 'true';
}

export function normalizeOptionalPref(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function resolveServerUrl(
  value: string | null,
  fallback: string,
): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function requireNonEmptyServerUrl(next: string): string {
  const clean = next.trim();
  if (!clean) {
    throw new Error('Server URL cannot be empty');
  }
  return clean;
}

export function booleanPrefToStorage(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Matches GUI preference `ebp.identity.autoLockMinutes`. */
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const AUTO_LOCK_MINUTE_OPTIONS = [5, 15, 60] as const;

export function parseStoredNumber(
  value: string | null,
  fallback: number,
): number {
  if (value === null) {
    return fallback;
  }
  const n = Number(value.trim());
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return n;
}

export function numberPrefToStorage(value: number): string {
  return String(value);
}

/** Snap to the settings picker. Anything else uses the default (15). */
export function parseAutoLockMinutes(
  value: string | null,
  fallback = DEFAULT_AUTO_LOCK_MINUTES,
): number {
  const n = parseStoredNumber(value, fallback);
  if ((AUTO_LOCK_MINUTE_OPTIONS as readonly number[]).includes(n)) {
    return n;
  }
  return fallback;
}

export function clampAutoLockMinutes(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return parseAutoLockMinutes(String(value));
  }
  if (typeof value === 'string') {
    return parseAutoLockMinutes(value);
  }
  return DEFAULT_AUTO_LOCK_MINUTES;
}
