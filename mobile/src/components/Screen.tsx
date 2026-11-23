import React from 'react';
import {ScrollView, StyleSheet, View, ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, layout} from '../theme/tokens';

export default function Screen({
  children,
  scroll = false,
  style,
  contentStyle,
  scrollRef,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  scrollRef?: React.Ref<ScrollView>;
}): JSX.Element {
  if (scroll) {
    return (
      <SafeAreaView style={[styles.safe, style]} edges={['left', 'right']}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, style]} edges={['left', 'right']}>
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
    padding: layout.gutter,
    paddingBottom: 32,
    gap: 14,
  },
});
