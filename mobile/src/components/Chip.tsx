import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radius, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

export default function Chip({label}: {label: string}): JSX.Element {
  const theme = usePlaceTheme();
  return (
    <View style={[styles.chip, {backgroundColor: theme.pale}]}>
      <View style={[styles.dot, {backgroundColor: theme.accent}]} />
      <Text style={[styles.label, {color: theme.accent}]}>{label}</Text>
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
