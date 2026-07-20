import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';

export default function InlineBusy({
  message = 'Loading…',
}: {
  message?: string;
}): JSX.Element {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="small" color={colors.accent} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: spacing.xl,
  },
  message: {
    fontSize: 13,
    color: colors.muted,
  },
});
