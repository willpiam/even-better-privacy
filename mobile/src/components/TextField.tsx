import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function TextField({
  label,
  multiline = false,
  style,
  testID,
  ...rest
}: TextInputProps & {
  label: string;
  testID?: string;
}): JSX.Element {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#aaa"
        {...rest}
        testID={testID}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  input: {
    fontSize: typography.body,
    color: colors.text,
    padding: 0,
    minHeight: 20,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
