import {sha256Hex} from '../../core/MessageHash.ts';
import {
  prepareDetailValue,
  requirePathAndDetail,
} from '../src/services/detailsLogic';

describe('detailsLogic', () => {
  test('prepareDetailValue hashes opaque paths only', () => {
    expect(prepareDetailValue('email', 'a@b.c')).toBe('a@b.c');
    expect(prepareDetailValue('opaque::email', 'a@b.c')).toBe(sha256Hex('a@b.c'));
  });

  test('requirePathAndDetail validates', () => {
    expect(() => requirePathAndDetail('', 'x')).toThrow(/required/);
    expect(() => requirePathAndDetail('email', '')).toThrow(/required/);
    expect(() => requirePathAndDetail('email', 'x')).not.toThrow();
  });
});
