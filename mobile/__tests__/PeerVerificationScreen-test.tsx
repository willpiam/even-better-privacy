import React from 'react';
import {AppState, Text} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import {useCodeScanner} from 'react-native-vision-camera';
import {Identity} from '../../core/Identity';
import {
  createVerificationOffer,
  signVerificationProof,
  verificationCode,
  verificationSession,
} from '../../core/PeerVerification';
import PeerVerificationScreen from '../src/screens/PeerVerificationScreen';
import AppButton from '../src/components/AppButton';
import {contactNfc} from '../src/services/contactNfc';
import {
  createPeerProof,
  savePeerEndorsement,
  startPeerVerification,
} from '../src/services/endorsements';
import {encodeVerificationFrames} from '../src/services/verificationTransfer';

jest.mock('@react-navigation/native', () => ({useIsFocused: () => true}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('react-native-svg', () => {
  const {View} = require('react-native');
  return {__esModule: true, default: View, Path: View, Rect: View};
});
jest.mock('react-native-vision-camera', () => ({
  Camera: Object.assign(() => null, {
    getCameraPermissionStatus: () => 'granted',
  }),
  useCameraDevice: () => ({id: 'back'}),
  useCodeScanner: jest.fn(options => options),
}));
jest.mock('../src/hooks/useIdentityUnlock', () => ({
  useIdentityUnlock: () => ({
    ensureUnlocked: async () => 'alice',
    unlockPrompt: null,
  }),
}));
jest.mock('../src/services/endorsements', () => ({
  startPeerVerification: jest.fn(),
  createPeerProof: jest.fn(),
  savePeerEndorsement: jest.fn(),
}));
jest.mock('../src/services/contactNfc', () => ({
  ...jest.requireActual('../src/services/contactNfc'),
  useContactNfcCapability: () => true,
  contactNfc: {
    receive: jest.fn(),
    cancelReceive: jest.fn(),
    startSharing: jest.fn(),
    stopSharing: jest.fn(),
  },
}));

const alice = new Identity('dilithium', 'kyber');
const bob = new Identity('dilithium', 'kyber');
const aliceOffer = createVerificationOffer(alice.summary, 'Alice');
const bobOffer = createVerificationOffer(bob.summary, 'Bob');
const bobProof = signVerificationProof(bob, bobOffer, aliceOffer);

test('exchanges through QR and NFC, then signs only after explicit comparison', async () => {
  const navigation = {replace: jest.fn()};
  const local = {
    identityName: 'alice',
    offer: aliceOffer,
    startedAt: Date.now(),
  };
  jest.mocked(startPeerVerification).mockResolvedValue(local);
  jest
    .mocked(createPeerProof)
    .mockResolvedValue(signVerificationProof(alice, aliceOffer, bobOffer));
  jest
    .mocked(contactNfc!.receive)
    .mockResolvedValue(encodeVerificationFrames('proof', bobProof).join('\n'));
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  let tree: renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = renderer.create(
        <PeerVerificationScreen
          navigation={navigation as never}
          route={{
            key: 'verify',
            name: 'PeerVerification',
            params: {fingerprint: bobOffer.identity.fingerprint},
          }}
        />,
      );
    });

    const button = (title: string) =>
      tree!.root
        .findAllByType(AppButton)
        .find(node => node.props.title === title);
    const press = (title: string) =>
      act(async () => button(title)!.props.onPress());
    const scan = (frames: string[]) =>
      act(async () => {
        const callback =
          jest.mocked(useCodeScanner).mock.lastCall![0].onCodeScanned;
        frames.forEach(value =>
          callback([{type: 'qr', value}], {width: 720, height: 720}),
        );
      });

    await press('Scan their offer QR');
    await scan(encodeVerificationFrames('offer', aliceOffer));
    expect(button('Sign my proof')).toBeUndefined();
    await press('Back to exchange');
    await press('Scan their offer QR');
    await scan(encodeVerificationFrames('offer', bobOffer));
    await press('Sign my proof');
    await press('Receive their proof via NFC');

    expect(contactNfc!.cancelReceive).toHaveBeenCalledTimes(1);
    const code = verificationCode(verificationSession(aliceOffer, bobOffer));
    expect(
      tree!.root.findAllByType(Text).some(node => node.props.children === code),
    ).toBe(true);
    expect(savePeerEndorsement).not.toHaveBeenCalled();
    await press('Codes match · Sign endorsement');
    expect(savePeerEndorsement).toHaveBeenCalledWith(
      local,
      bobOffer,
      bobProof,
      'Bob',
    );
    await press('View endorsement');
    expect(navigation.replace).toHaveBeenCalledWith('Endorsements', {
      fingerprint: bobOffer.identity.fingerprint,
    });
  } finally {
    await act(async () => tree?.unmount());
    AppState.currentState = previousState;
  }
});
