import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

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
      style={[
        styles.base,
        kind === 'success' ? styles.success : null,
        kind === 'error' ? styles.error : null,
      ]}>
      <Text
        style={[styles.text, kind === 'error' ? styles.errorText : null]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#eef4ff',
    borderColor: '#c6dcff',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  success: {
    backgroundColor: '#e8f8eb',
    borderColor: '#84d79a',
  },
  error: {
    backgroundColor: '#ffeef0',
    borderColor: '#ffb8bf',
  },
  text: {
    color: '#111',
  },
  errorText: {
    color: '#b00020',
  },
});
