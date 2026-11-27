import {Identity} from '../src/ebpCore';
import {loadIdentityUnlocked, mutateIdentityForUse} from '../src/services/storage';
import {deleteMailAccount, readMailStore} from '../src/services/mail/accountStore';
import {deleteEbpMailbox} from '../src/services/mail/ebpSignup';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../src/services/storage', () => ({
  unlockIdentity: jest.fn(),
  loadIdentityUnlocked: jest.fn(),
  mutateIdentityForUse: jest.fn(),
}));
jest.mock('../src/services/mail/accountStore', () => ({
  readMailStore: jest.fn(),
  deleteMailAccount: jest.fn(),
}));

const address = 'mailbox@pqpost.com';
const server = 'https://example.test';

test.each([address, 'replacement@pqpost.com'])(
  'hosted deletion removes only the matching local claim when the identity has %s',
  async currentAddress => {
    const identity = new Identity('dilithium', 'kyber');
    identity.attachDetail('email', currentAddress);
    jest.mocked(loadIdentityUnlocked).mockResolvedValue(identity);
    jest.mocked(mutateIdentityForUse).mockImplementation(
      async (_name, _password, mutate) => ({identity, result: await mutate(identity)}),
    );
    jest.mocked(readMailStore).mockResolvedValue({
      accounts: [{id: 'hosted', config: {fromEmail: address}}],
    } as never);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ok: true} as Response);
    try {
      await deleteEbpMailbox({
        identityName: 'Owner',
        password: 'fixture-password',
        server,
        email: address,
        confirm: address,
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({email: address});
      expect(identity.getDetail('email')).toBe(currentAddress === address ? null : currentAddress);
      expect(deleteMailAccount).toHaveBeenLastCalledWith('Owner', 'hosted');
    } finally {
      fetchMock.mockRestore();
    }
  },
);
