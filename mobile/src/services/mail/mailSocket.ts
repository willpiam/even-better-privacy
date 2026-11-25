import TcpSocket from 'react-native-tcp-socket';

export const connectTLS = TcpSocket.connectTLS;
export const createConnection = TcpSocket.createConnection;

export async function upgradeMailTls(socket: unknown): Promise<void> {
  // The iOS socket queues the upgrade on its existing connection.
  // eslint-disable-next-line no-new
  new TcpSocket.TLSSocket(socket as never);
}
