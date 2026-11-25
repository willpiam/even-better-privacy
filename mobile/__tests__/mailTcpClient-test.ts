jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {createConnection: jest.fn()},
}));
jest.mock('../src/services/mail/mailTrace', () => ({
  mailStub: jest.fn(async () => {}),
}));
jest.mock('../src/services/mail/mailSocket', () => ({
  ...jest.requireActual('../src/services/mail/mailSocket'),
  upgradeMailTls: jest.fn(),
}));

const {EventEmitter} = require('events');
import {Buffer} from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import {connectPlainLineClient} from '../src/services/mail/tcpClient';
import {MailByteBuffer} from '../src/services/mail/tcpBuffer';
import {upgradeMailTls} from '../src/services/mail/mailSocket';

function socketFixture() {
  const socket = Object.assign(new EventEmitter(), {
    write: jest.fn(),
    destroy: jest.fn(),
  });
  socket.destroy.mockImplementation(() => {
    socket.emit('close');
  });
  (TcpSocket.createConnection as jest.Mock).mockImplementation(
    (_options, connected) => {
      Promise.resolve().then(connected);
      return socket;
    },
  );
  return socket;
}

afterEach(() => jest.restoreAllMocks());

test('queued TCP readers receive fragmented lines and literals without losing trailing bytes', async () => {
  const socket = socketFixture();
  const client = await connectPlainLineClient({host: 'mock', port: 143});
  try {
    const greeting = client.readLine();
    socket.emit('data', Buffer.from('* OK hello\r'));
    socket.emit('data', Buffer.from('\nBODY\r\nhello)\r\n'));
    expect(await greeting).toBe('* OK hello');
    expect(await client.readLine()).toBe('BODY');
    expect(await client.readBytes(5)).toEqual(Buffer.from('hello'));
    expect(await client.readLine()).toBe(')');
    expect(await client.readBytes(0)).toEqual(Buffer.alloc(0));
  } finally {
    client.close();
  }
  expect(socket.destroy).toHaveBeenCalledTimes(1);
});

test('buffer overflow rejects every pending reader and closes the socket', async () => {
  const socket = socketFixture();
  const client = await connectPlainLineClient({host: 'mock', port: 143});
  jest.spyOn(MailByteBuffer.prototype, 'push').mockImplementation(() => {
    throw new Error('Mail receive buffer exceeds size limit');
  });
  const pending = Promise.allSettled([client.readLine(), client.readBytes(5)]);
  socket.emit('data', Buffer.from('data'));
  for (const result of await pending) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected')
      expect(result.reason.message).toContain('size limit');
  }
  expect(socket.destroy).toHaveBeenCalledTimes(1);
  await expect(client.readLine()).rejects.toThrow('TCP connection closed');
});

test('STARTTLS discards plaintext and waits for verification before allowing writes', async () => {
  const socket = socketFixture();
  const client = await connectPlainLineClient({host: 'mock', port: 143});
  let verified!: () => void;
  (upgradeMailTls as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => {
    verified = resolve;
  }));

  try {
    socket.emit('data', Buffer.from('leftover plaintext\r\n'));
    const upgrading = client.startTls!();
    expect(() => client.writeLine('LOGIN')).toThrow('TLS handshake is in progress');
    expect(socket.write).not.toHaveBeenCalled();
    verified();
    await upgrading;

    client.writeLine('LOGIN');
    expect(socket.write).toHaveBeenCalledWith('LOGIN\r\n');
    socket.emit('data', Buffer.from('secure response\r\n'));
    expect(await client.readLine()).toBe('secure response');
  } finally {
    client.close();
  }
});

test('STARTTLS verification failure closes the connection', async () => {
  const socket = socketFixture();
  const client = await connectPlainLineClient({host: 'mock', port: 143});
  (upgradeMailTls as jest.Mock).mockRejectedValueOnce(new Error('Hostname mismatch'));
  await expect(client.startTls!()).rejects.toThrow('Hostname mismatch');
  client.writeLine('LOGIN');
  expect(socket.write).not.toHaveBeenCalled();
  expect(socket.destroy).toHaveBeenCalledTimes(1);
});
