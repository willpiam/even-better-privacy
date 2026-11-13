import {decodeHeaderWords} from '../../services/mail/headerWords';
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';

// Shared with the mail mockup, scoped to mail so other app surfaces keep their theme.
export const mailColors = {
  page: '#f7f8f4',
  surface: '#ffffff',
  soft: '#f1f4ee',
  text: '#24392e',
  muted: '#626f65',
  border: '#e5e9e1',
  accent: '#285e47',
  accentSoft: '#e8efe4',
};

const paths = {
  search: 'M21 21l-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  refresh:
    'M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12-2L20 8M4 16l2.5 3a7.5 7.5 0 0 0 12-2',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  compose: 'M13 5H4v16h16v-9M10 14l1-5 8-8 4 4-8 8z',
} as const;

export function MailIcon({
  name,
}: {
  name: keyof typeof paths;
}): React.JSX.Element {
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={mailColors.accent}
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: mailColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {color: mailColors.accent, fontSize: 13, fontWeight: '600'},
});
