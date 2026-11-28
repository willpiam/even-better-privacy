import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Identity} from '../../core/Identity';
import AppButton from '../src/components/AppButton';
import IdentityQrScreen from '../src/screens/IdentityQrScreen';
import {contactNfc, decodeNfcContact} from '../src/services/contactNfc';
import {readIdentityRaw} from '../src/services/storage';

jest.mock('@react-navigation/native', () => ({useIsFocused: () => true}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('react-native-svg', () => {
  const {View} = require('react-native');
  return {__esModule: true, default: View, Path: View, Rect: View};
});
jest.mock('../src/services/storage', () => ({readIdentityRaw: jest.fn()}));
jest.mock('../src/services/contactNfc', () => ({
  ...jest.requireActual('../src/services/contactNfc'),
  useContactNfcCapability: () => true,
  contactNfc: {startSharing: jest.fn(), stopSharing: jest.fn()},
}));

test('shares the displayed identity only after a tap and stops when the screen closes', async () => {
  const email = 'alice@example.test';
  const identity = new Identity('dilithium', 'kyber');
  identity.attachDetail('email', email);
  jest
    .mocked(readIdentityRaw)
    .mockResolvedValue(
      identity.toStorageFormatWithKey(new Uint8Array(32), new Uint8Array(16)),
    );
  const start = jest.mocked(contactNfc!.startSharing);
  start.mockResolvedValue(undefined);

  let tree: renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = renderer.create(
        <IdentityQrScreen
          navigation={{} as never}
          route={{
            key: 'share',
            name: 'IdentityQr',
            params: {identityName: 'Alice'},
          }}
        />,
      );
    });
    expect(start).not.toHaveBeenCalled();

    const button = tree!.root.findByType(AppButton);
    expect(button.props.title).toBe('Share via NFC');
    await act(async () => button.props.onPress());
    expect(start).toHaveBeenCalledTimes(1);
    expect(decodeNfcContact(start.mock.calls[0][0])).toMatchObject({
      name: 'Alice',
      email,
      identity: {fingerprint: identity.toFingerprint()},
    });
  } finally {
    await act(async () => tree?.unmount());
  }
  expect(contactNfc!.stopSharing).toHaveBeenCalledTimes(1);
});
