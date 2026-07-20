import React from 'react';
import SegmentedControl from './SegmentedControl';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {CryptoStackParamList} from '../navigation/AppNavigator';

export default function CryptoModeSwitch({
  mode,
  navigation,
}: {
  mode: 'sign' | 'encrypt';
  navigation: NativeStackNavigationProp<
    CryptoStackParamList,
    'SignVerify' | 'EncryptDecrypt'
  >;
}): JSX.Element {
  return (
    <SegmentedControl
      value={mode}
      onChange={next => {
        if (next === 'sign') {
          navigation.navigate('SignVerify');
        } else {
          navigation.navigate('EncryptDecrypt');
        }
      }}
      options={[
        {label: 'Sign / Verify', value: 'sign'},
        {label: 'Encrypt / Decrypt', value: 'encrypt'},
      ]}
    />
  );
}
