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
