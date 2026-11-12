jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {createConnection: jest.fn()},
}));
jest.mock('../src/services/mail/mailTrace', () => ({
  mailStub: jest.fn(async () => {}),
}));

const {EventEmitter} = require('events');
import {Buffer} from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import {connectPlainLineClient} from '../src/services/mail/tcpClient';
import {MailByteBuffer} from '../src/services/mail/tcpBuffer';

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
    expect(await client.readBytes(5)).toBe('hello');
    expect(await client.readLine()).toBe(')');
    expect(await client.readBytes(0)).toBe('');
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
