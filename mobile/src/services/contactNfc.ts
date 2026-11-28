import {useEffect, useState} from 'react';
import {NativeModules, Platform} from 'react-native';
import {ContactQrScanner, type ScannedContact} from './contactQr';

// Keep in sync with ContactNfcProtocol.maxPayloadBytes in Android.
export const MAX_NFC_PAYLOAD_BYTES = 8192;

type NfcCapability = 'share' | 'receive';

type ContactNfcModule = {
  getCapabilities(): Promise<Record<NfcCapability, boolean>>;
  startSharing(payload: string): Promise<void>;
  stopSharing(): void;
  receive(): Promise<string>;
  cancelReceive(): void;
};

export const contactNfc: ContactNfcModule | undefined =
  Platform.OS === 'android' ? NativeModules.EbpContactNfc : undefined;

export function useContactNfcCapability(capability: NfcCapability): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let active = true;
    contactNfc?.getCapabilities().then(
      capabilities => {
        if (active) setSupported(capabilities[capability]);
      },
      () => {
        if (active) setSupported(false);
      },
    );
    return () => {
      active = false;
    };
  }, [capability]);
  return supported;
}

export function decodeNfcContact(payload: string): ScannedContact {
  const scanner = new ContactQrScanner();
  const frames = payload.split('\n');
  let result: ReturnType<ContactQrScanner['add']> | undefined;
  for (const frame of frames) result = scanner.add(frame);
  if (!result?.contact || result.total !== frames.length) {
    throw new Error('The NFC contact transfer was incomplete.');
  }
  return result.contact;
}
