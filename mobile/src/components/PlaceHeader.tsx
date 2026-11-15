import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {places, type Place, usePlaceTheme} from '../theme/PlaceTheme';
import {colors} from '../theme/tokens';
import FoxArt from './FoxArt';

export default function PlaceHeader({
  title,
  subtitle,
  eyebrow = 'EVEN BETTER PRIVACY',
  place: override,
}: {
  title: string;
  subtitle: string;
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
        <Text style={[styles.eyebrow, {color: palette.accent}]}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={[styles.place, {color: palette.accent}]}>
          {palette.label}
        </Text>
      </View>
      {showArt ? <FoxArt place={place} size={width < 390 ? 92 : 116} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 16,
    minHeight: 160,
  },
  copy: {flex: 1, minWidth: 0, gap: 7},
  eyebrow: {fontSize: 9, fontWeight: '600', letterSpacing: 1.6},
  title: {
    fontSize: 30,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -1,
  },
  subtitle: {fontSize: 13, lineHeight: 19, color: colors.muted},
  place: {
    fontSize: 11,
    marginTop: 3,
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
});
