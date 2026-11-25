import {Buffer} from 'buffer';
import {NativeEventEmitter, NativeModules} from 'react-native';

const native = NativeModules.EbpMailSocket;
const eventName = 'EbpMailSocketEvent';
const events = new NativeEventEmitter(native);
let nextId = 1;

type ConnectionOptions = {host: string; port: number; connectTimeout?: number};
type Listener = (...args: unknown[]) => void;
type SocketEvent = {id: number; type: 'data' | 'error' | 'close'; data?: string};

function open(options: ConnectionOptions, implicitTls: boolean, connected: () => void) {
  const id = nextId++;
  const listeners = new Map<string, Listener[]>();
  let closed = false;

  function emit(type: string, value?: unknown) {
    for (const listener of listeners.get(type) ?? []) listener(value);
  }

  function detach() {
    if (closed) return;
    closed = true;
    subscription.remove();
    listeners.clear();
  }

  const subscription = events.addListener(eventName, (event: SocketEvent) => {
    if (event.id !== id) return;
    if (event.type === 'data') emit('data', Buffer.from(event.data ?? '', 'base64'));
    else if (event.type === 'error') emit('error', new Error(event.data));
    else {
      emit('close');
      detach();
    }
  });

  void native.connect(id, options.host, options.port, implicitTls, options.connectTimeout ?? 30_000)
    .then(() => { if (!closed) connected(); })
    .catch((error: Error) => {
      if (!closed) emit('error', error);
      detach();
    });

  return {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    write(data: string | Buffer) {
      if (closed) return;
      const bytes = typeof data === 'string' ? Buffer.from(data) : data;
      native.write(id, bytes.toString('base64'));
    },
    destroy() {
      if (closed) return;
      detach();
      native.close(id);
    },
    startTls(): Promise<void> {
      return native.startTls(id);
    },
  };
}

export function connectTLS(options: ConnectionOptions, connected: () => void) {
  return open(options, true, connected);
}

export function createConnection(options: ConnectionOptions, connected: () => void) {
  return open(options, false, connected);
}

export function upgradeMailTls(socket: unknown): Promise<void> {
  return (socket as ReturnType<typeof open>).startTls();
}
