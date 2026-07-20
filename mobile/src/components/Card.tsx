import React from 'react';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius} from '../theme/tokens';

export default function Card({
  children,
  style,
  padded = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.card, padded && styles.padded, style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  padded: {
    padding: 14,
  },
});
