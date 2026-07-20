import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';

export default function SectionTitle({
  children,
}: {
  children: string;
}): JSX.Element {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.section,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: spacing.xs,
    paddingHorizontal: 2,
  },
});
