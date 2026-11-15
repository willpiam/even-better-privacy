import React from 'react';
import {StyleSheet, Text, TextInput, TextInputProps, View} from 'react-native';
import {colors, radius, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

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
  const theme = usePlaceTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View
      style={[
        styles.wrap,
        {borderColor: focused ? theme.accent : theme.border},
      ]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        scrollEnabled={multiline}
        {...rest}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        onFocus={event => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
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
    paddingVertical: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 7,
  },
  input: {
    fontSize: typography.body,
    color: colors.text,
    padding: 0,
    minHeight: 24,
  },
  multiline: {
    minHeight: 72,
    maxHeight: 180,
    textAlignVertical: 'top',
  },
});
