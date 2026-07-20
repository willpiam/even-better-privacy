/**
 * @format
 */

import 'react-native';
import React from 'react';
import renderer from 'react-test-renderer';

jest.mock('../src/navigation/AppNavigator', () => {
  const ReactMock = require('react');
  return function MockAppNavigator() {
    return ReactMock.createElement('View', {testID: 'app-navigator'});
  };
});

jest.mock('../src/services/cryptoInit', () => ({
  ensureNativeCryptoReady: jest.fn(() => Promise.resolve()),
}));

import App from '../App';

it('renders correctly', () => {
  renderer.create(<App />);
});
