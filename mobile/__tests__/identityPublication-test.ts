import {
  fetchIdentityPublication,
  isEmailVerified,
  isDetailPublished,
  mergeIdentityDetails,
  type IdentityPublication,
} from '../src/services/identityPublication';

const fingerprint = 'ebp-test-fingerprint';
const email = {path: 'email', detail: 'alice@example.com', proof: 'proof'};
const record = {
  fingerprint,
  signingKeyType: 'dilithium' as const,
  encryptionKeyType: 'kyber' as const,
  signingKey: 'signing',
  encryptionKey: 'encryption',
  signingKeyDetails: {variant: 'ml_dsa87'},
  encryptionKeyDetails: {variant: 'ml_kem1024'},
  details: {email: [email.detail, email.proof] as [string, string]},
  detailsMeta: {email: {verified: true, verifiedAt: 123}},
};
const published: IdentityPublication = {state: 'published', identity: record};
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn();
function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}
beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

it('reads publication and verification from the selected server without publishing', async () => {
  respond(200, record);
  const result = await fetchIdentityPublication(
    fingerprint,
    'https://keys.example///',
  );
  expect(fetchMock).toHaveBeenCalledWith(
    `https://keys.example/api/v1/identity/${fingerprint}`,
    {signal: undefined},
  );
  expect(result.state).toBe('published');
  expect(isEmailVerified(email, result)).toBe(true);
});
it.each([404, 400])('recognizes an absent identity (HTTP %s)', async status => {
  respond(status, {error: 'unknown subject'});
  expect(
    await fetchIdentityPublication(fingerprint, 'https://keys.example'),
  ).toEqual({state: 'unpublished'});
});
it.each([401, 500])(
  'keeps server failures distinct from an unpublished identity (HTTP %s)',
  async status => {
    respond(status, {error: 'server failure'});
    await expect(
      fetchIdentityPublication(fingerprint, 'https://keys.example'),
    ).rejects.toThrow('server failure');
  },
);
it('rejects a response for another fingerprint', async () => {
  respond(200, {...record, fingerprint: 'another-identity'});
  await expect(
    fetchIdentityPublication(fingerprint, 'https://keys.example'),
  ).rejects.toThrow('different identity');
});
it('does not label a revoked identity or its email as verified', async () => {
  respond(200, {...record, revoked: true});
  const result = await fetchIdentityPublication(
    fingerprint,
    'https://keys.example',
  );
  expect(result.state).toBe('revoked');
  expect(isEmailVerified(email, result)).toBe(false);
});
it('does not apply old verification to a changed local email', () => {
  expect(
    isEmailVerified({...email, detail: 'new@example.com'}, published),
  ).toBe(false);
  expect(
    isDetailPublished({...email, detail: 'new@example.com'}, published),
  ).toBe(false);
});
it('requires an affirmative verification flag for the same email path', () => {
  expect(
    isEmailVerified(email, {
      state: 'published',
      identity: {...record, detailsMeta: {}},
    }),
  ).toBe(false);
  expect(isEmailVerified({...email, path: 'name'}, published)).toBe(false);
});
it('strips revoked email details even if their old metadata says verified', async () => {
  respond(200, {...record, revokedDetails: ['email']});
  const result = await fetchIdentityPublication(
    fingerprint,
    'https://keys.example',
  );
  expect(isEmailVerified(email, result)).toBe(false);
  expect(mergeIdentityDetails([], result)).toEqual([]);
});
it('handles verified opaque emails without substituting the cleartext path', () => {
  const opaque = {...email, path: 'opaque::email', detail: 'email-hash'};
  const publication: IdentityPublication = {
    state: 'published',
    identity: {
      ...record,
      details: {'opaque::email': [opaque.detail, opaque.proof]},
      detailsMeta: {'opaque::email': {verified: true, verifiedAt: 123}},
    },
  };
  expect(isEmailVerified(opaque, publication)).toBe(true);
  expect(isEmailVerified(email, publication)).toBe(false);
});
it.each<[IdentityPublication]>([
  [{state: 'checking'}],
  [{state: 'unpublished'}],
  [{state: 'unavailable', message: 'Offline'}],
])(
  'never claims verification with unresolved or absent publication (%j)',
  publication => {
    expect(isEmailVerified(email, publication)).toBe(false);
  },
);
it('prefers local edits and still shows server details when the identity is locked', () => {
  const edited = {...email, detail: 'new@example.com'};
  expect(mergeIdentityDetails([edited], published)).toEqual([edited]);
  expect(mergeIdentityDetails([], published)).toEqual([email]);
});

it('does not reintroduce a locally revoked email from the server', () => {
  expect(mergeIdentityDetails([], published, ['email'])).toEqual([]);
});
