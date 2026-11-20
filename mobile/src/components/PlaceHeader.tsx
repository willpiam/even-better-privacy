import React from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {places, type Place, usePlaceTheme} from '../theme/PlaceTheme';
import {colors, spacing, typography} from '../theme/tokens';
import FoxArt from './FoxArt';

export default function PlaceHeader({
  title,
  subtitle,
  eyebrow,
  place: override,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  place?: Place;
}) {
  const theme = usePlaceTheme();
  const place = override ?? theme.place;
  const palette = places[place];
  const {width, fontScale} = useWindowDimensions();
  const showArt = width >= 350 && fontScale < 1.5;
  return (
    <View style={styles.heading}>
      <View style={styles.copy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, {color: palette.accent}]}>
            {eyebrow}
          </Text>
        ) : null}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {showArt ? <FoxArt place={place} size={width < 390 ? 88 : 104} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  copy: {flex: 1, minWidth: 0, gap: spacing.xs},
  eyebrow: {fontSize: typography.caption, fontWeight: '600'},
  title: {
    fontSize: typography.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
  },
  subtitle: {fontSize: typography.body, color: colors.muted},
});
