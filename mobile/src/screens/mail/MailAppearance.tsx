import {decodeHeaderWords} from '../../services/mail/headerWords';
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {places} from '../../theme/PlaceTheme';
import {colors, layout, typography} from '../../theme/tokens';

// Mail shares the app surfaces and uses the meadow accents for interactions.
export const mailColors = {
  ...colors,
  ...places.mail,
  accentSoft: places.mail.pale,
};

const paths = {
  archive: 'M3 3h18v5H3zM5 8v13h14V8M10 12h4',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  search: 'M21 21l-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  refresh: 'M20 3v5h-5M20 8a9 9 0 1 0 0 8',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  compose: 'M13 5H4v16h16v-9M10 14l1-5 8-8 4 4-8 8z',
  reply: 'M9 4L3 10l6 6M3 10h10a8 8 0 0 1 8 8v2',
} as const;

export function MailIcon({
  name,
  color = mailColors.accent,
}: {
  name: keyof typeof paths;
  color?: string;
}): React.JSX.Element {
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round">
      <Path d={paths[name]} />
    </Svg>
  );
}

export function mailSenderLabel(address: string): string {
  const name = address.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  return decodeHeaderWords(name || address.trim()) || 'Unknown sender';
}

export function MailAvatar({address}: {address: string}): React.JSX.Element {
  const label = mailSenderLabel(address);
  const words = label.split(/\s+/);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : label.slice(0, 2);
  return (
    <View style={styles.avatar} accessible={false}>
      <Text style={styles.initials}>{initials.toUpperCase()}</Text>
    </View>
  );
}

export function mailDateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() !== today.getFullYear()
          ? {year: 'numeric' as const}
          : {}),
      });
}

const styles = StyleSheet.create({
  avatar: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: layout.avatarSize / 2,
    backgroundColor: mailColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: mailColors.accent,
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
