import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radius, typography} from '../theme/tokens';

export default function Chip({label}: {label: string}): JSX.Element {
  return (
    <View style={styles.chip}>
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.accent,
  },
});
