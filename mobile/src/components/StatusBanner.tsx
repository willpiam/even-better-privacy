import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radius} from '../theme/tokens';

export default function StatusBanner({
  message,
  kind = 'info',
}: {
  message: string;
  kind?: 'info' | 'success' | 'error';
}): JSX.Element | null {
  if (!message) {
    return null;
  }
  return (
    <View
      testID="status-banner"
      style={[
        styles.base,
        kind === 'success' ? styles.success : null,
        kind === 'error' ? styles.error : null,
        kind === 'info' ? styles.info : null,
      ]}>
      <Text
        testID="status-banner-text"
        style={[
          styles.text,
          kind === 'success' ? styles.successText : null,
          kind === 'error' ? styles.errorText : null,
          kind === 'info' ? styles.infoText : null,
        ]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    padding: 10,
  },
  info: {
    backgroundColor: colors.accentSoft,
  },
  success: {
    backgroundColor: colors.successSoft,
  },
  error: {
    backgroundColor: colors.dangerSoft,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoText: {color: colors.accent},
  successText: {color: colors.success},
  errorText: {color: colors.danger},
});
