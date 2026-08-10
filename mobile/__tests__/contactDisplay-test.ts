import {
  condenseFingerprint,
  contactSearchHaystack,
  resolveContactLabels,
  type ContactLike,
} from '../src/services/contactDisplay';
import {shortFingerprint} from '../../core/Fingerprint';

const LONG_FP =
  'ebpdk1qqqqqqqqqqabcdefghijklmnopqr0123456789xyzabcdefghij';

function like(overrides: Partial<ContactLike> = {}): ContactLike {
  return {
    fingerprint: LONG_FP,
    ...overrides,
  };
}

describe('contactDisplay', () => {
  test('shortFingerprint uses 12…12 for long fingerprints', () => {
    expect(shortFingerprint(LONG_FP)).toBe(
      `${LONG_FP.slice(0, 12)}…${LONG_FP.slice(-12)}`,
    );
  });

  test('shortFingerprint leaves short fingerprints unchanged', () => {
    expect(shortFingerprint('ebpdk1short')).toBe('ebpdk1short');
  });

  test('condenseFingerprint aliases shortFingerprint', () => {
    expect(condenseFingerprint(LONG_FP)).toBe(shortFingerprint(LONG_FP));
  });

  test('alias wins as primary', () => {
    const labels = resolveContactLabels(
      like({
        localAlias: 'Bob',
        details: {
          name: ['Published', 'proof'],
          email: ['bob@example.com', 'proof'],
        },
      }),
    );
    expect(labels.primary).toBe('Bob');
    expect(labels.secondary).toBe('bob@example.com');
  });

  test('name detail is primary when no alias', () => {
    const labels = resolveContactLabels(
      like({
        details: {
          name: ['Alice', 'proof'],
          email: ['alice@example.com', 'proof'],
        },
      }),
    );
    expect(labels.primary).toBe('Alice');
    expect(labels.secondary).toBe('alice@example.com');
  });

  test('email-as-primary uses condensed fingerprint as secondary', () => {
    const labels = resolveContactLabels(
      like({
        details: {email: ['solo@example.com', 'proof']},
      }),
    );
    expect(labels.primary).toBe('solo@example.com');
    expect(labels.secondary).toBe(shortFingerprint(LONG_FP));
  });

  test('falls back to condensed fingerprint for both lines', () => {
    const labels = resolveContactLabels(like());
    const condensed = shortFingerprint(LONG_FP);
    expect(labels.primary).toBe(condensed);
    expect(labels.secondary).toBe(condensed);
  });

  test('resolved opaque email counts as email', () => {
    const labels = resolveContactLabels(
      like({
        details: {name: ['Named', 'proof']},
        resolvedOpaqueEmail: 'opaque@example.com',
      }),
    );
    expect(labels.primary).toBe('Named');
    expect(labels.secondary).toBe('opaque@example.com');
  });

  test('haystack includes alias and email', () => {
    const hay = contactSearchHaystack(
      like({
        localAlias: 'MyAlias',
        storageName: 'stubfile',
        details: {email: ['findme@example.com', 'proof']},
      }),
    );
    expect(hay).toContain('myalias');
    expect(hay).toContain('findme@example.com');
    expect(hay).toContain('stubfile');
    expect(hay).toContain(LONG_FP.toLowerCase());
  });
});
