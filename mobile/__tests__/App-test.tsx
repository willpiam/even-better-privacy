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

import App from '../App';

it('renders correctly', async () => {
  let tree: renderer.ReactTestRenderer;
  await renderer.act(async () => {
    tree = renderer.create(<App />);
  });
  expect(tree!.root).toBeTruthy();
  await renderer.act(async () => {
    tree!.unmount();
  });
});
