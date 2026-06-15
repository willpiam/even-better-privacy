import TcpSocket from 'react-native-tcp-socket';

export type TcpLineClient = {
  writeLine: (line: string) => void;
  readLine: () => Promise<string>;
  close: () => void;
};

export function connectTlsLineClient(params: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<TcpLineClient> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('TCP connection timed out'));
    }, params.timeoutMs ?? 30_000);

    let buffer = '';
    const waiters: Array<(line: string) => void> = [];

    const flushLines = () => {
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) {
          break;
        }
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const waiter = waiters.shift();
        if (waiter) {
          waiter(line);
        }
      }
    };

    const socket = TcpSocket.createConnection(
      {
        host: params.host,
        port: params.port,
        tls: true,
        tlsCheckValidity: true,
      },
      () => {
        clearTimeout(timeout);
        resolve({
          writeLine: (line: string) => {
            socket.write(`${line}\r\n`);
          },
          readLine: () =>
            new Promise<string>(res => {
              const tryFlush = () => {
                const idx = buffer.indexOf('\r\n');
                if (idx >= 0) {
                  const line = buffer.slice(0, idx);
                  buffer = buffer.slice(idx + 2);
                  res(line);
                  return;
                }
                waiters.push(res);
              };
              tryFlush();
            }),
          close: () => socket.destroy(),
        });
      },
    );

    socket.on('data', (data: string | Buffer) => {
      buffer += typeof data === 'string' ? data : data.toString('utf8');
      flushLines();
    });
    socket.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function readTaggedOk(
  client: TcpLineClient,
  tag: string,
): Promise<string[]> {
  const lines: string[] = [];
  while (true) {
    const line = await client.readLine();
    lines.push(line);
    if (line.startsWith(`${tag} `)) {
      if (!line.includes(' OK')) {
        throw new Error(line);
      }
      return lines;
    }
  }
}
