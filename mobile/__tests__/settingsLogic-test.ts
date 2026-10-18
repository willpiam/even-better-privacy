import {
  booleanPrefToStorage,
  normalizeOptionalPref,
  parseEnforcePasswordPolicy,
  parseStoredBoolean,
  requireNonEmptyServerUrl,
  resolveServerUrl,
} from '../src/services/settingsLogic';

describe('settingsLogic', () => {
  test('parseStoredBoolean uses fallback for null', () => {
    expect(parseStoredBoolean(null, false)).toBe(false);
    expect(parseStoredBoolean(null, true)).toBe(true);
    expect(parseStoredBoolean('true', false)).toBe(true);
    expect(parseStoredBoolean('false', true)).toBe(false);
    expect(parseStoredBoolean('yes', false)).toBe(false);
  });

  test('parseEnforcePasswordPolicy defaults to true', () => {
    expect(parseEnforcePasswordPolicy(null)).toBe(true);
    expect(parseEnforcePasswordPolicy('false')).toBe(false);
    expect(parseEnforcePasswordPolicy('true')).toBe(true);
  });

  test('normalizeOptionalPref trims', () => {
    expect(normalizeOptionalPref(null)).toBe('');
    expect(normalizeOptionalPref('  abc  ')).toBe('abc');
  });

  test('resolveServerUrl and requireNonEmptyServerUrl', () => {
    expect(resolveServerUrl(null, 'https://fallback')).toBe('https://fallback');
    expect(resolveServerUrl('  https://x  ', 'https://fallback')).toBe(
      'https://x',
    );
    expect(requireNonEmptyServerUrl(' https://ok ')).toBe('https://ok');
    expect(() => requireNonEmptyServerUrl('  ')).toThrow(/empty/);
  });

  test('booleanPrefToStorage', () => {
    expect(booleanPrefToStorage(true)).toBe('true');
    expect(booleanPrefToStorage(false)).toBe('false');
  });
});
