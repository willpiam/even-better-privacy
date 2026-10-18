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
  /**
   * Upgrade a plain-TCP client to TLS after a successful STARTTLS command.
   * No-op / throws if already TLS or if the underlying socket cannot upgrade.
   */
  startTls?: (options?: {rejectUnauthorized?: boolean}) => Promise<void>;
};

export type MailTlsMode = 'implicit-tls' | 'starttls';

/** Pure helper: secure=true → implicit TLS; secure=false → plain then STARTTLS. */
export function resolveMailTlsMode(secure: boolean): MailTlsMode {
  return secure ? 'implicit-tls' : 'starttls';
}

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

type AnySocket = {
  write: (data: string | Buffer) => void;
  destroy: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  once?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function dataPreview(text: string): string {
  const oneLine = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

function attachLineClient(
  socket: AnySocket,
  params: {
    endpoint: string;
    readTimeoutMs: number;
    allowStartTls: boolean;
  },
): TcpLineClient {
  let buffer = Buffer.alloc(0);
  const waiters: Waiter[] = [];
  let closed = false;
  let sawData = false;
  let activeSocket: AnySocket = socket;
  let tlsUpgraded = !params.allowStartTls;

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

  const onData = (data: unknown) => {
    const chunk =
      typeof data === 'string'
        ? Buffer.from(data, 'binary')
        : Buffer.from(data as Buffer);
    if (!sawData) {
      sawData = true;
      void mailStub(
        'tcp.data',
        `bytes≈${chunk.length} preview=${dataPreview(chunk.toString('binary'))}`,
      );
    }
    buffer = Buffer.concat([Buffer.from(buffer), Buffer.from(chunk)]);
    tryDeliver();
  };

  const onError = (err: unknown) => {
    closed = true;
    const error = err instanceof Error ? err : new Error(String(err));
    failWaiters(error);
  };

  const onClose = () => {
    closed = true;
    failWaiters(new Error('TCP connection closed'));
  };

  const bindSocket = (next: AnySocket) => {
    activeSocket = next;
    next.on('data', onData);
    next.on('error', onError);
    next.on('close', onClose);
  };

  bindSocket(socket);

  const destroySocket = () => {
    closed = true;
    try {
      activeSocket.destroy();
    } catch {
      // ignore
    }
  };

  const client: TcpLineClient = {
    writeLine: (line: string) => {
      if (!closed) {
        activeSocket.write(`${line}\r\n`);
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
          void mailStub('tcp.readLine.timeout', params.endpoint);
          const err = new Error('TCP readLine timed out');
          destroySocket();
          failWaiters(err);
          rej(err);
        }, params.readTimeoutMs);
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
          void mailStub('tcp.readBytes.timeout', params.endpoint);
          const err = new Error('TCP readBytes timed out');
          destroySocket();
          failWaiters(err);
          rej(err);
        }, params.readTimeoutMs);
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
  };

  if (params.allowStartTls) {
    client.startTls = (options?: {rejectUnauthorized?: boolean}) =>
      new Promise<void>((resolve, reject) => {
        if (tlsUpgraded) {
          reject(new Error('TLS already negotiated'));
          return;
        }
        if (closed) {
          reject(new Error('TCP connection closed'));
          return;
        }
        void mailStub('tcp.starttls.start', params.endpoint);
        try {
          // TLSSocket shares the native socket id and calls startTLS. Keep I/O
          // on the original JS socket so we do not double-bind data listeners.
          // eslint-disable-next-line no-new
          new TcpSocket.TLSSocket(activeSocket as never, {
            rejectUnauthorized: options?.rejectUnauthorized ?? true,
          });
          tlsUpgraded = true;
          void mailStub('tcp.starttls.ok', params.endpoint);
          resolve();
        } catch (error) {
          const err =
            error instanceof Error ? error : new Error(String(error));
          void mailStub('tcp.starttls.error', err.message);
          reject(err);
        }
      });
  }

  return client;
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

    let settledConnect = false;
    let client: TcpLineClient | null = null;

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
        void mailStub('tcp.connect.ok', `${endpoint} tls=implicit`);
        resolve(client!);
      },
    );

    // Attach immediately so a fast greeting is buffered, not dropped.
    client = attachLineClient(socket as unknown as AnySocket, {
      endpoint,
      readTimeoutMs,
      allowStartTls: false,
    });

    const connectTimer = setTimeout(() => {
      void mailStub('tcp.connect.timeout', endpoint);
      try {
        client?.close();
      } catch {
        // ignore
      }
      if (!settledConnect) {
        settledConnect = true;
        reject(new Error('TCP connection timed out'));
      }
    }, params.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

    socket.on('error', (err: Error) => {
      clearTimeout(connectTimer);
      if (!settledConnect) {
        settledConnect = true;
        void mailStub('tcp.connect.error', `${endpoint} ${err.message}`);
        reject(err);
      }
    });
  });
}

/** Open a plain-TCP line client (IMAP 143 / SMTP 587 before STARTTLS). */
export function connectPlainLineClient(params: {
  host: string;
  port: number;
  timeoutMs?: number;
  readTimeoutMs?: number;
}): Promise<TcpLineClient> {
  const endpoint = `${params.host}:${params.port}`;
  const readTimeoutMs = params.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    void mailStub('tcp.connect.start', `${endpoint} plain`);

    let settledConnect = false;
    let client: TcpLineClient | null = null;

    const socket = TcpSocket.createConnection(
      {
        host: params.host,
        port: params.port,
      },
      () => {
        if (settledConnect) {
          return;
        }
        settledConnect = true;
        clearTimeout(connectTimer);
        void mailStub('tcp.connect.ok', `${endpoint} tls=plain`);
        resolve(client!);
      },
    );

    client = attachLineClient(socket as unknown as AnySocket, {
      endpoint,
      readTimeoutMs,
      allowStartTls: true,
    });

    const connectTimer = setTimeout(() => {
      void mailStub('tcp.connect.timeout', endpoint);
      try {
        client?.close();
      } catch {
        // ignore
      }
      if (!settledConnect) {
        settledConnect = true;
        reject(new Error('TCP connection timed out'));
      }
    }, params.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

    socket.on('error', (err: Error) => {
      clearTimeout(connectTimer);
      if (!settledConnect) {
        settledConnect = true;
        void mailStub('tcp.connect.error', `${endpoint} ${err.message}`);
        reject(err);
      }
    });
  });
}

/**
 * Connect for mail: implicit TLS when `secure`, else plain TCP (caller must
 * complete STARTTLS via {@link TcpLineClient.startTls} after the protocol command).
 */
export async function connectMailLineClient(params: {
  host: string;
  port: number;
  secure: boolean;
  timeoutMs?: number;
  readTimeoutMs?: number;
}): Promise<TcpLineClient> {
  const mode = resolveMailTlsMode(params.secure);
  await mailStub('tcp.connect.mode', mode);
  if (mode === 'implicit-tls') {
    return connectTlsLineClient(params);
  }
  return connectPlainLineClient(params);
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
