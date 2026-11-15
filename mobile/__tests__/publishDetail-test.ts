jest.mock('../src/services/storage', () => ({
  loadIdentityForUse: jest.fn(),
  mutateIdentityForUse: jest.fn(),
}));
jest.mock('../src/services/settings', () => ({
  getServerUrl: jest.fn(async () => 'https://keys.example'),
}));
import {publishDetail} from '../src/services/details';
import {
  loadIdentityForUse,
  mutateIdentityForUse,
} from '../src/services/storage';
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
it('publishes the existing opaque hash and proof without rehashing or replacing the local detail', async () => {
  jest.mocked(loadIdentityForUse).mockResolvedValue({
    toFingerprint: () => 'ebp-alice',
    details: new Map([['opaque::email', ['existing-hash', 'signed-proof']]]),
  } as never);
  fetchMock.mockResolvedValue({ok: true});
  await publishDetail({identityName: 'Alice', path: 'opaque::email'});
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    fingerprint: 'ebp-alice',
    path: 'opaque::email',
    detail: 'existing-hash',
    proof: 'signed-proof',
  });
  expect(mutateIdentityForUse).not.toHaveBeenCalled();
});
it('reports a rejected upload instead of claiming success', async () => {
  jest.mocked(loadIdentityForUse).mockResolvedValue({
    toFingerprint: () => 'ebp-alice',
    details: new Map([['email', ['alice@example.com', 'proof']]]),
  } as never);
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({error: 'invalid proof'}),
  });
  await expect(
    publishDetail({identityName: 'Alice', path: 'email'}),
  ).rejects.toThrow('invalid proof');
});
