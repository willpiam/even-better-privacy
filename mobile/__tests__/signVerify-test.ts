import {Identity} from '../../core/Identity';
import {signMessageWithIdentity} from '../src/services/signVerifyLogic';
import {verifyMessage} from '../src/services/signVerify';
import {loadContact} from '../src/services/contacts';

jest.mock('react-native-fs', () => ({}));
jest.mock('../src/services/storage', () => ({}));
jest.mock('../src/services/contacts', () => ({loadContact: jest.fn()}));

let identity: Identity;
beforeAll(() => {
  identity = new Identity('dilithium', 'kyber');
});
beforeEach(() => {
  jest.mocked(loadContact).mockReset();
  jest.mocked(loadContact).mockResolvedValue(identity.summary);
});

it('verifies attached payloads with embedded keys without loading contacts', async () => {
  const payload = signMessageWithIdentity(identity, 'embedded sender', {
    includeIdentity: true,
  });
  expect(await verifyMessage({payload})).toEqual({verified: true});
  expect(loadContact).not.toHaveBeenCalled();
  await expect(
    verifyMessage({payload: {...payload, message: 'tampered'}}),
  ).rejects.toThrow('Message hash mismatch');
});

it('resolves saved contacts and explicit public keys for detached signatures', async () => {
  const message = 'detached sender';
  const payload = signMessageWithIdentity(identity, message, {detached: true});
  expect(await verifyMessage({payload, message, sender: 'saved'})).toEqual({
    verified: true,
  });
  expect(loadContact).toHaveBeenCalledWith('saved');
  jest.mocked(loadContact).mockClear();
  expect(
    await verifyMessage({payload, message, publicIdentity: identity.summary}),
  ).toEqual({verified: true});
  expect(loadContact).not.toHaveBeenCalled();
});

it('rejects unsupported payloads and missing signing keys through the shared verifier', async () => {
  await expect(verifyMessage({payload: {type: 'unknown'}})).rejects.toThrow(
    'Unsupported payload type',
  );
  const payload = signMessageWithIdentity(identity, 'message');
  await expect(
    verifyMessage({
      payload,
      publicIdentity: {...identity.summary, signingKey: ''},
    }),
  ).rejects.toThrow('public identity missing signing key');
});
