import React, {useEffect, useId, useState} from 'react';
import {AccessibilityInfo, Image, StyleSheet, View} from 'react-native';
import Svg, {
  Defs,
  Image as SvgImage,
  Mask,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import type {Place} from '../theme/PlaceTheme';

const scenes = require('../assets/fox/fox-places.webp');
const loops = require('../assets/fox/fox-loops.webp');
const tiles: Record<Place, [number, number]> = {
  mail: [0, 0],
  identities: [1, 0],
  contacts: [2, 0],
  tools: [0, 1],
  settings: [1, 1],
  compose: [2, 1],
};

/** Native SVG mask softly blends the original atlas into each place's paper. */
export default function FoxArt({
  place,
  size = 120,
}: {
  place: Place;
  size?: number;
}) {
  const id = useId().replace(/:/g, '');
  const [col, row] = tiles[place];
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 512 512" accessible={false}>
        <Defs>
          <RadialGradient id={`fade${id}`}>
            <Stop offset="0.48" stopColor="white" />
            <Stop offset="1" stopColor="white" stopOpacity="0" />
          </RadialGradient>
          <Mask
            id={`mask${id}`}
            x="0"
            y="0"
            width="512"
            height="512"
            maskUnits="userSpaceOnUse">
            <Rect width="512" height="512" fill={`url(#fade${id})`} />
          </Mask>
        </Defs>
        <SvgImage
          href={scenes}
          x={-col * 512}
          y={-row * 512}
          width={1536}
          height={1024}
          mask={`url(#mask${id})`}
        />
      </Svg>
    </View>
  );
}

/** Six original frames; real operations control lifetime, never simulated delays. */
export function FoxMotion({
  motion = 'watch',
  size = 88,
}: {
  motion?: 'sniff' | 'watch' | 'carry' | 'rest';
  size?: number;
}) {
  const [frame, setFrame] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const row = {sniff: 0, watch: 1, carry: 2, rest: 3}[motion];
  const duration = {sniff: 1800, watch: 2400, carry: 900, rest: 3000}[motion];
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    setFrame(0);
    if (reducedMotion) return;
    const timer = setInterval(
      () => setFrame(value => (value + 1) % 6),
      duration / 6,
    );
    return () => clearInterval(timer);
  }, [duration, reducedMotion]);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.viewport, {width: size, height: size}]}>
      <Image
        source={loops}
        resizeMode="stretch"
        style={[
          styles.atlas,
          {
            width: size * 6,
            height: size * 4,
            left: -frame * size,
            top: -row * size,
          },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  viewport: {overflow: 'hidden'},
  atlas: {position: 'absolute'},
});
