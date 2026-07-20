import TcpSocket from 'react-native-tcp-socket';
import {Buffer} from 'buffer';
import {mailStub} from './mailTrace';
import {takeBytesFromBuffer, takeLineFromBuffer} from './tcpBuffer';

export {takeBytesFromBuffer, takeLineFromBuffer} from './tcpBuffer';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;

export type TcpLineClient = {
  writeLine: (line: string) => void;
  readLine: () => Promise<string>;
  /** Consume exactly `n` octets from the stream (IMAP/SMTP literals). */
  readBytes: (n: number) => Promise<string>;
  close: () => void;
};

type Waiter =
  | {
      kind: 'line';
      resolve: (line: string) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: 'bytes';
      n: number;
      resolve: (chunk: string) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    };

function dataPreview(text: string): string {
  const oneLine = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

/**
 * Open an implicit-TLS line client (IMAP 993 / SMTP 465).
 *
 * Must use `connectTLS` — `createConnection({ tls: true })` does **not** enable
 * TLS on Android (pendingTLS is only set via startTLS/connectTLS), so the
 * socket would be plain TCP against a TLS port and hang waiting for a text greeting.
 *
 * Reads are on-demand (no eager line splitting) so IMAP `{n}` literals can be
 * consumed with {@link TcpLineClient.readBytes} without being torn into lines.
 */
export function connectTlsLineClient(params: {
  host: string;
  port: number;
  timeoutMs?: number;
  readTimeoutMs?: number;
}): Promise<TcpLineClient> {
  const endpoint = `${params.host}:${params.port}`;
  const readTimeoutMs = params.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    void mailStub('tcp.connect.start', endpoint);

    const connectTimer = setTimeout(() => {
      void mailStub('tcp.connect.timeout', endpoint);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reject(new Error('TCP connection timed out'));
    }, params.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

    let buffer = Buffer.alloc(0);
    const waiters: Waiter[] = [];
    let closed = false;
    let settledConnect = false;
    let sawData = false;

    const failWaiters = (err: Error) => {
      while (waiters.length > 0) {
        const w = waiters.shift();
        if (w) {
          clearTimeout(w.timer);
          w.reject(err);
        }
      }
    };

    const tryDeliver = () => {
      while (waiters.length > 0) {
        const head = waiters[0];
        if (head.kind === 'line') {
          const taken = takeLineFromBuffer(buffer);
          if (!taken) {
            break;
          }
          buffer = taken.rest;
          waiters.shift();
          clearTimeout(head.timer);
          head.resolve(taken.line);
        } else {
          const taken = takeBytesFromBuffer(buffer, head.n);
          if (!taken) {
            break;
          }
          buffer = taken.rest;
          waiters.shift();
          clearTimeout(head.timer);
          head.resolve(taken.chunk);
        }
      }
    };

    const destroySocket = () => {
      closed = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    };

    const socket = TcpSocket.connectTLS(
      {
        host: params.host,
        port: params.port,
        rejectUnauthorized: true,
      },
      () => {
        if (settledConnect) {
          return;
        }
        settledConnect = true;
        clearTimeout(connectTimer);
        void mailStub('tcp.connect.ok', endpoint);
        resolve({
          writeLine: (line: string) => {
            if (!closed) {
              socket.write(`${line}\r\n`);
            }
          },
          readLine: () =>
            new Promise<string>((res, rej) => {
              if (closed) {
                rej(new Error('TCP connection closed'));
                return;
              }
              const taken = takeLineFromBuffer(buffer);
              if (taken) {
                buffer = taken.rest;
                res(taken.line);
                return;
              }
              const timer = setTimeout(() => {
                const idx = waiters.findIndex(w => w.timer === timer);
                if (idx >= 0) {
                  waiters.splice(idx, 1);
                }
                void mailStub('tcp.readLine.timeout', endpoint);
                const err = new Error('TCP readLine timed out');
                destroySocket();
                failWaiters(err);
                rej(err);
              }, readTimeoutMs);
              waiters.push({kind: 'line', resolve: res, reject: rej, timer});
            }),
          readBytes: (n: number) =>
            new Promise<string>((res, rej) => {
              if (closed) {
                rej(new Error('TCP connection closed'));
                return;
              }
              if (n < 0) {
                rej(new Error('readBytes count must be non-negative'));
                return;
              }
              const taken = takeBytesFromBuffer(buffer, n);
              if (taken) {
                buffer = taken.rest;
                res(taken.chunk);
                return;
              }
              const timer = setTimeout(() => {
                const idx = waiters.findIndex(w => w.timer === timer);
                if (idx >= 0) {
                  waiters.splice(idx, 1);
                }
                void mailStub('tcp.readBytes.timeout', endpoint);
                const err = new Error('TCP readBytes timed out');
                destroySocket();
                failWaiters(err);
                rej(err);
              }, readTimeoutMs);
              waiters.push({
                kind: 'bytes',
                n,
                resolve: res,
                reject: rej,
                timer,
              });
            }),
          close: () => {
            destroySocket();
            failWaiters(new Error('TCP connection closed'));
          },
        });
      },
    );

    socket.on('data', (data: string | Buffer) => {
      const chunk =
        typeof data === 'string' ? Buffer.from(data, 'binary') : Buffer.from(data);
      if (!sawData) {
        sawData = true;
        void mailStub(
          'tcp.data',
          `bytes≈${chunk.length} preview=${dataPreview(chunk.toString('binary'))}`,
        );
      }
      buffer = Buffer.concat([Buffer.from(buffer), Buffer.from(chunk)]);
      tryDeliver();
    });
    socket.on('error', (err: Error) => {
      clearTimeout(connectTimer);
      closed = true;
      failWaiters(err);
      if (!settledConnect) {
        settledConnect = true;
        void mailStub('tcp.connect.error', `${endpoint} ${err.message}`);
        reject(err);
      }
    });
    socket.on('close', () => {
      closed = true;
      failWaiters(new Error('TCP connection closed'));
    });
  });
}

export async function readTaggedOk(
  client: TcpLineClient,
  tag: string,
): Promise<string[]> {
  await mailStub('tcp.readLine.wait', `tag=${tag}`);
  const lines: string[] = [];
  while (true) {
    const line = await client.readLine();
    lines.push(line);
    if (line.startsWith(`${tag} `)) {
      if (!line.includes(' OK')) {
        await mailStub('tcp.readLine.ok', `tag=${tag} fail=${line.slice(0, 80)}`);
        throw new Error(line);
      }
      await mailStub('tcp.readLine.ok', `tag=${tag}`);
      return lines;
    }
  }
}
