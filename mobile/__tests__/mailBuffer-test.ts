import {Buffer} from 'buffer';
import {MailByteBuffer} from '../src/services/mail/tcpBuffer';

test('fragmented lines, CRLF boundaries, Unicode literals and trailing responses preserve octets', () => {
  const queue = new MailByteBuffer();
  queue.push(Buffer.from('hello\r'));
  expect(queue.takeLine()).toBeNull();
  queue.push(Buffer.from('\n'));
  expect(queue.takeLine()).toBe('hello');
  const body = Buffer.from('héllo 😀');
  for (const byte of body) queue.push(Uint8Array.of(byte));
  queue.push(Buffer.from(')\r\na1 OK\r\n'));
  expect(queue.takeBytes(body.length)).toBe('héllo 😀');
  expect(queue.takeLine()).toBe(')');
  expect(queue.takeLine()).toBe('a1 OK');
  expect(queue.length).toBe(0);
  expect(queue.takeBytes(0)).toBe('');
});

test('an 8 MiB fragmented literal uses linear copying instead of copying the accumulated buffer on arrival', () => {
  const queue = new MailByteBuffer();
  const size = 8 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024, 65);
  const allocation = jest.spyOn(Buffer, 'allocUnsafe');
  const concatenation = jest.spyOn(Buffer, 'concat');
  try {
    for (let sent = 0; sent < size; sent += chunk.length) {
      queue.push(chunk);
      if (sent + chunk.length < size) expect(queue.takeBytes(size)).toBeNull();
    }
    const body = queue.takeBytes(size)!;
    expect(body.length).toBe(size);
    expect(body[0]).toBe('A');
    const allocated = allocation.mock.calls.reduce((sum, [n]) => sum + n, 0);
    const concatenated = concatenation.mock.calls.reduce(
      (sum, [chunks]) => sum + chunks.reduce((n, item) => n + item.length, 0),
      0,
    );
    expect(allocated + concatenated).toBeLessThanOrEqual(size * 2);
  } finally {
    allocation.mockRestore();
    concatenation.mockRestore();
  }
});

test('line scans resume across arrivals and remain correct after chunk compaction', () => {
  const queue = new MailByteBuffer();
  for (let i = 0; i < 200; i++) queue.push(Buffer.from(`line ${i}\n`));
  for (let i = 0; i < 200; i++) expect(queue.takeLine()).toBe(`line ${i}`);
  for (let i = 0; i < 100; i++) {
    queue.push(Buffer.from('x'));
    expect(queue.takeLine()).toBeNull();
  }
  queue.push(Buffer.from('\n'));
  expect(queue.takeLine()).toBe('x'.repeat(100));
  queue.push(Buffer.from('tail\n'));
  expect(queue.takeBytes(2)).toBe('ta');
  expect(queue.takeLine()).toBe('il');
});

test('receive buffers and literal counts are bounded', () => {
  const queue = new MailByteBuffer(10);
  queue.push(Buffer.from('1234567890'));
  expect(() => queue.push(Buffer.from('x'))).toThrow('size limit');
  for (const n of [-1, 0.5, NaN, Infinity, 11])
    expect(() => queue.takeBytes(n)).toThrow('literal length');
  queue.clear();
  expect(queue.length).toBe(0);
  queue.push(Buffer.from('ok\n'));
  expect(queue.takeLine()).toBe('ok');
});
