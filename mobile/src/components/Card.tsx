import React from 'react';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

export default function Card({
  children,
  style,
  padded = false,
  testID,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  testID?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {borderColor: theme.border},
        padded && styles.padded,
        style,
      ]}>
      {children}
    </View>
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
    padding: 18,
  },
});
