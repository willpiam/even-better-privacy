import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {PanResponder, Text} from 'react-native';
import SwipeMailRow from '../src/screens/mail/SwipeMailRow';
jest.mock('../src/screens/mail/MailAppearance', () => ({MailIcon: () => null}));
it.each([
  [120, 'archive'],
  [-120, 'delete'],
  [40, null],
] as const)('handles a horizontal drag of %s points', async (dx, expected) => {
  const create = jest.spyOn(PanResponder, 'create');
  const onAction = jest.fn().mockResolvedValue(undefined);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SwipeMailRow disabled={false} onAction={onAction}>
        <Text>Message</Text>
      </SwipeMailRow>,
    );
  });
  const handlers = create.mock.calls[0][0];
  expect(
    handlers.onMoveShouldSetPanResponder!(
      {} as never,
      {dx: 5, dy: 30} as never,
    ),
  ).toBe(false);
  expect(
    handlers.onMoveShouldSetPanResponder!(
      {} as never,
      {dx: 30, dy: 5} as never,
    ),
  ).toBe(true);
  await act(async () => {
    handlers.onPanResponderMove!({} as never, {dx} as never);
    handlers.onPanResponderRelease!({} as never, {dx} as never);
  });
  if (expected) expect(onAction).toHaveBeenCalledWith(expected);
  else expect(onAction).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  create.mockRestore();
});
