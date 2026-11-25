package com.mobile;

import java.io.IOException;
import java.net.Socket;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

final class MailTls {
  private MailTls() {}

  static SSLSocket handshake(Socket transport, String hostname, int port, int timeoutMs)
      throws IOException {
    SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
    // Pass the configured host to JSSE so endpoint identification and SNI use it.
    SSLSocket socket = (SSLSocket) factory.createSocket(transport, hostname, port, true);
    try {
      socket.setSoTimeout(timeoutMs);
      SSLParameters parameters = socket.getSSLParameters();
      parameters.setEndpointIdentificationAlgorithm("HTTPS");
      socket.setSSLParameters(parameters);
      socket.startHandshake();
      socket.setSoTimeout(0);
      return socket;
    } catch (IOException | RuntimeException error) {
      try {
        socket.close();
      } catch (IOException closeError) {
        error.addSuppressed(closeError);
      }
      throw error;
    }
  }
}
