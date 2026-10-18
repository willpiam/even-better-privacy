import {
  createRandomIdentity,
  enforceAtLeastOneExportKey,
  resolveOpaqueDetailPath,
} from '../src/services/identity';

jest.mock('../src/services/settings', () => ({
  getEnforcePasswordPolicy: jest.fn(async () => false),
}));

jest.mock('../src/ebpCore', () => ({
  Identity: jest.fn().mockImplementation((signingType: string) => ({
    signingKeyType: signingType,
    encryptionKeyType: 'kyber',
    toFingerprint: () => `fp-${signingType}`,
  })),
  validatePassword: jest.fn((password: string) =>
    password.trim()
      ? {ok: true, suggestions: []}
      : {ok: false, reason: 'Password is required', suggestions: []},
  ),
}));

const mockPersistIdentity = jest.fn();
jest.mock('../src/services/storage', () => ({
  persistIdentity: (...args: unknown[]) => mockPersistIdentity(...args),
}));

describe('identity helpers', () => {
  beforeEach(() => {
    mockPersistIdentity.mockReset();
    mockPersistIdentity.mockImplementation(
      async (params: {
        name: string;
        identity: {signingKeyType: string; toFingerprint: () => string};
        overwrite?: boolean;
      }) => {
        if (params.name === 'exists' && !params.overwrite) {
          throw new Error('Identity already exists');
        }
        return {
          name: params.name,
          fingerprint: params.identity.toFingerprint(),
          signingKeyType: params.identity.signingKeyType,
          encryptionKeyType: 'kyber',
        };
      },
    );
  });

  test('resolveOpaqueDetailPath prefixes unless already opaque', () => {
    expect(resolveOpaqueDetailPath('email', true)).toBe('opaque::email');
    expect(resolveOpaqueDetailPath('opaque::email', true)).toBe('opaque::email');
    expect(resolveOpaqueDetailPath('email', false)).toBe('email');
    expect(resolveOpaqueDetailPath('  name  ', true)).toBe('opaque::name');
  });

  test('enforceAtLeastOneExportKey re-enables the other key', () => {
    expect(enforceAtLeastOneExportKey(false, false, 'signing')).toEqual({
      includeSigningKey: false,
      includeEncryptionKey: true,
    });
    expect(enforceAtLeastOneExportKey(false, false, 'encryption')).toEqual({
      includeSigningKey: true,
      includeEncryptionKey: false,
    });
    expect(enforceAtLeastOneExportKey(true, false, 'encryption')).toEqual({
      includeSigningKey: true,
      includeEncryptionKey: false,
    });
  });

  test('createRandomIdentity persists with signing type', async () => {
    const meta = await createRandomIdentity({
      name: 'alice',
      password: 'Test-password1',
      signingType: 'sphincs',
    });
    expect(meta.signingKeyType).toBe('sphincs');
    expect(meta.fingerprint).toBe('fp-sphincs');
    expect(mockPersistIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'alice',
        password: 'Test-password1',
        overwrite: undefined,
      }),
    );
  });

  test('createRandomIdentity rejects existing without overwrite', async () => {
    await expect(
      createRandomIdentity({
        name: 'exists',
        password: 'Test-password1',
        signingType: 'dilithium',
      }),
    ).rejects.toThrow(/already exists/);
  });

  test('createRandomIdentity succeeds with overwrite', async () => {
    const meta = await createRandomIdentity({
      name: 'exists',
      password: 'Test-password1',
      signingType: 'dilithium',
      overwrite: true,
    });
    expect(meta.name).toBe('exists');
    expect(mockPersistIdentity).toHaveBeenCalledWith(
      expect.objectContaining({overwrite: true}),
    );
  });
});
