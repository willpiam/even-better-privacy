import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import {colors, layout, radius, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

type Variant = 'primary' | 'secondary' | 'danger';

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
  accessibilityLabel = title,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  const isDisabled = disabled || loading;
  const backgroundColor = {
    primary: theme.accent,
    secondary: theme.pale,
    danger: colors.danger,
  }[variant];
  const labelColor = isDisabled
    ? colors.muted
    : variant === 'secondary'
    ? theme.accent
    : '#fff';
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        {backgroundColor: isDisabled ? colors.segmentTrack : backgroundColor},
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={labelColor} /> : null}
      <Text style={[styles.label, {color: labelColor}]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.controlHeight,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: {opacity: 0.9},
  label: {
    fontSize: typography.body,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
});
