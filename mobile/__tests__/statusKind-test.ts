import {statusKind} from '../src/theme/statusKind';

describe('statusKind', () => {
  test('a missing verified mailbox is an error even though it says verified', () => {
    expect(statusKind(
      'this identity has no verified @pqpost.com mailbox on the key server',
    )).toBe('error');
  });

  test('a key-server lookup failure is an error', () => {
    expect(statusKind('Key server could not look up this mailbox (HTTP 500).')).toBe('error');
  });

  test('a successful verification stays success', () => {
    expect(statusKind('Email verified')).toBe('success');
  });
});
