import React from 'react';
import {StyleSheet, View} from 'react-native';
import {layout} from '../theme/tokens';

/** Lets rows reach the safe-area edges of a screen with the standard gutter. */
export default function ListSection({children}: {children: React.ReactNode}) {
  return <View style={styles.section}>{children}</View>;
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: -layout.gutter,
  },
});
