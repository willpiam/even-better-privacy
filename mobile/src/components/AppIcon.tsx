import React from 'react';
import Svg, {Path} from 'react-native-svg';
import {colors} from '../theme/tokens';

const paths = {
  key: 'M15 3a6 6 0 1 1-4.8 9.6L3 20H1v-3l7.4-7.4A6 6 0 0 1 15 3ZM16 7h.01',
  contacts:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.87',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 5-6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  settings:
    'm9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h5l1-3 3-2v-3l2-2-2-4-3-1-1-3ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  certificate: 'M6 3h12v12H6ZM9 15v7l3-2 3 2v-7M9 7h6M9 11h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 11v6M12 7h.01',
  sign: 'M13 5H4v16h16v-9M10 14l1-5 8-8 4 4-8 8z',
  verify: 'm5 12 4 4L19 6',
  file: 'M14 2H4v20h16V8ZM14 2v6h6M8 13h8M8 17h5',
  fingerprint:
    'M4 10a8 8 0 0 1 16 0M8 21c2-3 2-6 2-11a2 2 0 0 1 4 0c0 5 0 9-2 12M5 15v-5a7 7 0 0 1 14 0v5M4 20l1-2M17 21l1-3',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7-2.6',
  chevron: 'm9 5 7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-5-5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
} as const;
export type IconName = keyof typeof paths;

export default function AppIcon({
  name,
  size = 22,
  color = colors.accent,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={name === 'more' ? 3.5 : 1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}>
      <Path d={paths[name]} />
    </Svg>
  );
}
