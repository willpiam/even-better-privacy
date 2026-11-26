import React from 'react';
import {AppState, Text} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import {Identity} from '../../core/Identity';
import ContactQrScanScreen from '../src/screens/ContactQrScanScreen';
import AppButton from '../src/components/AppButton';
import {encodeContactQr} from '../src/services/contactQr';
import {importScannedContact} from '../src/services/contacts';

jest.mock('@react-navigation/native', () => ({useIsFocused: () => true}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('react-native-vision-camera', () => ({
  Camera: Object.assign(() => null, {
    getCameraPermissionStatus: () => 'granted',
  }),
  useCameraDevice: () => ({id: 'back'}),
  useCodeScanner: jest.fn(options => options),
}));
jest.mock('../src/services/contacts', () => ({
  importScannedContact: jest.fn(),
}));

import {useCodeScanner} from 'react-native-vision-camera';

test('shows the fingerprint for review and saves only after confirmation', async () => {
  const {summary} = new Identity('dilithium', 'kyber');
  const frames = encodeContactQr(summary, 'Alice');
  const navigation = {
    setOptions: jest.fn(),
    isFocused: () => true,
    replace: jest.fn(),
  };
  const scanner = jest.mocked(useCodeScanner);
  const save = jest.mocked(importScannedContact);
  save.mockResolvedValue('saved-contact');

  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  let tree: renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = renderer.create(
        <ContactQrScanScreen
          navigation={navigation as never}
          route={{key: 'scan', name: 'ContactQrScan'}}
        />,
      );
    });
    const scan = (value: string) =>
      scanner.mock.lastCall![0].onCodeScanned([{type: 'qr', value}], {
        width: 720,
        height: 720,
      });
    await act(async () => {
      frames.slice(0, -1).forEach(scan);
    });
    expect(
      tree!.root.findAllByType(AppButton).map(node => node.props.title),
    ).not.toContain('Add contact');

    await act(async () => scan(frames.at(-1)!));
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      title: 'Verify contact details',
    });
    expect(
      tree!.root
        .findAllByType(Text)
        .some(node => node.props.children === summary.fingerprint),
    ).toBe(true);
    expect(save).not.toHaveBeenCalled();

    const add = tree!.root
      .findAllByType(AppButton)
      .find(node => node.props.title === 'Add contact');
    await act(async () => add!.props.onPress());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: summary.fingerprint,
      }),
      'Alice',
    );
    expect(navigation.replace).toHaveBeenCalledWith('ContactDetail', {
      name: 'saved-contact',
    });
  } finally {
    await act(async () => tree?.unmount());
    AppState.currentState = previousState;
  }
});
