// Runs only in the local, network-disabled WebView, outside Hermes.
import {Identity} from '../../../../core/Identity';
import {encryptMailBody} from './mailCrypto';
import type {MailCryptoInput} from './mailCryptoTypes';

declare const window: {
  ReactNativeWebView: {postMessage: (value: string) => void};
  encryptMail: (input: MailCryptoInput) => void;
};
window.encryptMail = input => {
  const key = new Uint8Array(input.key);
  input.key.fill(0);
  try {
    const identity = Identity.fromStorageFormatWithKey(input.raw, key);
    const result = encryptMailBody(
      identity,
      input.contacts,
      input.message,
      input.sign,
      input.includePublicKeys,
    );
    window.ReactNativeWebView.postMessage(JSON.stringify({result}));
  } catch {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        error: 'Could not encrypt message. Unlock your identity and try again.',
      }),
    );
  } finally {
    key.fill(0);
  }
};
window.ReactNativeWebView.postMessage(JSON.stringify({ready: true}));
