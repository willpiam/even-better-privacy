import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';

const tinyLogo = require('../../../assets/tiny-logo.png');

export default function BrandHeader(): JSX.Element {
  return (
    <View style={styles.row}>
      <Image
        source={tinyLogo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="EBP logo"
      />
      <View style={styles.meta}>
        <Text style={styles.title}>EBP</Text>
        <Text style={styles.subtitle}>Even Better Privacy</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
