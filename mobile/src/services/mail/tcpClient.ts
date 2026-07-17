import TcpSocket from 'react-native-tcp-socket';
import {mailStub} from './mailTrace';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;

export type TcpLineClient = {
  writeLine: (line: string) => void;
  readLine: () => Promise<string>;
  close: () => void;
};

type LineWaiter = {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Extract one complete line from the front of `buffer`.
 * Accepts CRLF or bare LF; strips a trailing CR if present.
 * Returns null if no full line is available yet.
 */
export function takeLineFromBuffer(buffer: string): {
  line: string;
  rest: string;
} | null {
  const lf = buffer.indexOf('\n');
  if (lf < 0) {
    return null;
  }
  let line = buffer.slice(0, lf);
  if (line.endsWith('\r')) {
    line = line.slice(0, -1);
  }
  return {line, rest: buffer.slice(lf + 1)};
}

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

    let buffer = '';
    const pendingLines: string[] = [];
    const waiters: LineWaiter[] = [];
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

    const deliverOrQueue = (line: string) => {
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(line);
      } else {
        pendingLines.push(line);
      }
    };

    const flushLines = () => {
      while (true) {
        const taken = takeLineFromBuffer(buffer);
        if (!taken) {
          break;
        }
        buffer = taken.rest;
        deliverOrQueue(taken.line);
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
              if (pendingLines.length > 0) {
                res(pendingLines.shift() as string);
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
              waiters.push({resolve: res, reject: rej, timer});
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
        typeof data === 'string' ? data : data.toString('utf8');
      if (!sawData) {
        sawData = true;
        void mailStub(
          'tcp.data',
          `bytes≈${chunk.length} preview=${dataPreview(chunk)}`,
        );
      }
      buffer += chunk;
      flushLines();
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
