import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {colors, spacing} from '../theme/tokens';
import {FoxMotion} from './FoxArt';
import {usePlaceTheme} from '../theme/PlaceTheme';

export default function InlineBusy({
  message = 'Loading…',
}: {
  message?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  return (
    <View style={styles.wrap}>
      <FoxMotion motion="sniff" size={56} />
      <ActivityIndicator size="small" color={theme.accent} />
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {message}
      </Text>
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
    flexShrink: 1,
  },
});
