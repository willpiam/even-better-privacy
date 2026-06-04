import {ready as libsodiumReady} from 'react-native-libsodium';

let initPromise: Promise<void> | null = null;

/** Load native libsodium once before any crypto_pwhash / randombytes use. */
export function ensureNativeCryptoReady(): Promise<void> {
  if (!initPromise) {
    initPromise = libsodiumReady;
  }
  return initPromise;
}
