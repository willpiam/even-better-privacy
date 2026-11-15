import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

const tinyLogo = require('../../../assets/tiny-logo.png');

export default function BrandHeader({
  compact = false,
}: {
  compact?: boolean;
}): JSX.Element {
  const theme = usePlaceTheme();
  return (
    <View style={[styles.row, compact && styles.compact]}>
      <Image
        source={tinyLogo}
        style={[styles.logo, compact && styles.compactLogo]}
        resizeMode="contain"
        accessibilityLabel="EBP logo"
      />
      <View style={styles.meta}>
        <Text
          style={[
            styles.title,
            compact && styles.compactTitle,
            {color: theme.accent},
          ]}>
          {compact ? 'Even Better Privacy' : 'EBP'}
        </Text>
        {!compact ? (
          <Text style={styles.subtitle}>Even Better Privacy</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {marginBottom: 0, gap: 8},
  compactLogo: {width: 28, height: 28, borderRadius: 10},
  compactTitle: {fontSize: 14, fontWeight: '600', letterSpacing: -0.3},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingHorizontal: 2,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.muted,
  },
});
