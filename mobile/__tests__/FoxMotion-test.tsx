import React from 'react';
import {AccessibilityInfo, Image, StyleSheet} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import {FoxMotion} from '../src/components/FoxArt';

// Motion must stop immediately for accessibility changes and when work ends.
describe('fox progress artwork', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('honors reduced motion, responds to preference changes, and cleans up', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const remove = jest.fn();
    const subscribe = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({remove} as unknown as ReturnType<
        typeof AccessibilityInfo.addEventListener
      >);
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<FoxMotion size={80} />);
    });
    const preferenceChanged = subscribe.mock.calls[0][1] as unknown as (
      value: boolean,
    ) => void;
    const offset = () =>
      StyleSheet.flatten(tree!.root.findByType(Image).props.style).left;
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(offset()).toBeCloseTo(0);
    await act(async () => {
      preferenceChanged(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(offset()).toBe(-80);
    await act(async () => {
      preferenceChanged(true);
    });
    expect(offset()).toBeCloseTo(0);
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(offset()).toBeCloseTo(0);
    await act(async () => {
      preferenceChanged(false);
    });
    const clearTimer = jest.spyOn(globalThis, 'clearInterval');
    await act(async () => {
      tree!.unmount();
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(clearTimer).toHaveBeenCalledTimes(1);
  });
});
