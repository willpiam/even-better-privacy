import {Buffer} from 'buffer';
import RNFS from 'react-native-fs';
import {Identity} from '../../core/Identity';
import {
  createFileCleartextEnvelope,
  buildEncryptedSignedFilePayload,
} from '../../core/FilePayload';
import {MAX_ENCRYPTED_FILE_BYTES} from '../../common/FileLimits';
import {encryptFile, decryptFile} from '../src/services/encryptDecrypt';

const mockRecipient = new Identity('dilithium', 'kyber');
const mockSender = new Identity('dilithium', 'kyber');
jest.mock('react-native-fs', () => ({stat: jest.fn(), read: jest.fn()}));
jest.mock('../src/services/contacts', () => ({
  loadContact: async () => mockRecipient.summary,
}));
jest.mock('../src/services/storage', () => ({
  loadIdentityForUse: async () => mockRecipient,
}));
jest.mock('../src/services/senderContext', () => ({
  resolveSenderForDecrypt: async () => ({
    contact: mockSender.summary,
    isKnownContact: true,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('oversized files are rejected before native reads; small and empty files use bounded reads', async () => {
  const params = {
    identityName: 'me',
    recipient: 'recipient',
    fileUri: '/file',
    fileName: 'file.bin',
  };
  jest
    .mocked(RNFS.stat)
    .mockResolvedValue({size: MAX_ENCRYPTED_FILE_BYTES + 1} as Awaited<
      ReturnType<typeof RNFS.stat>
    >);
  await expect(encryptFile(params)).rejects.toThrow('max supported size');
  expect(RNFS.read).not.toHaveBeenCalled();
  for (const data of ['', 'hello']) {
    const bytes = Buffer.from(data);
    jest
      .mocked(RNFS.stat)
      .mockResolvedValue({size: bytes.length} as Awaited<
        ReturnType<typeof RNFS.stat>
      >);
    jest.mocked(RNFS.read).mockResolvedValue(bytes.toString('base64'));
    const result = await encryptFile(params);
    expect(result.fileSize).toBe(bytes.length);
    if (bytes.length === 0) expect(RNFS.read).not.toHaveBeenCalled();
    else
      expect(RNFS.read).toHaveBeenLastCalledWith(
        '/file',
        bytes.length + 1,
        0,
        'base64',
      );
  }
});

test('a file growing during a read is rejected', async () => {
  jest
    .mocked(RNFS.stat)
    .mockResolvedValue({size: 1} as Awaited<ReturnType<typeof RNFS.stat>>);
  jest
    .mocked(RNFS.read)
    .mockResolvedValue(Buffer.from('xx').toString('base64'));
  await expect(
    encryptFile({
      identityName: 'me',
      recipient: 'recipient',
      fileUri: '/file',
      fileName: 'file',
    }),
  ).rejects.toThrow('File changed');
});

test('signed files with invalid signatures return no file contents', async () => {
  const attacker = new Identity('dilithium', 'kyber');
  const bytes = Buffer.from('file contents');
  const envelope = createFileCleartextEnvelope(bytes, 'file.txt');
  const payload = buildEncryptedSignedFilePayload({
    recipientFingerprint: mockRecipient.toFingerprint(),
    senderFingerprint: mockSender.toFingerprint(),
    fileName: 'file.txt',
    mimeType: 'text/plain',
    fileSize: bytes.length,
    ciphertext: attacker.signAndEncryptFor(
      JSON.stringify(envelope),
      mockRecipient.summary,
    ),
  });
  await expect(
    decryptFile({identityName: 'me', payload, sender: 'sender'}),
  ).rejects.toThrow('File signature verification failed');
  payload.ciphertext = mockSender.signAndEncryptFor(
    JSON.stringify(envelope),
    mockRecipient.summary,
  );
  expect(
    (await decryptFile({identityName: 'me', payload, sender: 'sender'}))
      .verified,
  ).toBe(true);
});
