import React from 'react';
import {ScrollView, StyleSheet, View, ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, spacing} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

export default function Screen({
  children,
  scroll = false,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}): JSX.Element {
  const theme = usePlaceTheme();
  if (scroll) {
    return (
      <SafeAreaView
        style={[styles.safe, {backgroundColor: theme.page}, style]}
        edges={['left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safe, {backgroundColor: theme.page}, style]}
      edges={['left', 'right']}>
      <View style={[styles.content, styles.flex, contentStyle]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.page,
  },
  flex: {flex: 1},
  content: {
    padding: spacing.lg + 4,
    paddingBottom: 32,
    gap: 14,
  },
});
