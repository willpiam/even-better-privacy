import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import {colors, radius, typography} from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'danger';

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}): JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' ? colors.accent : '#fff'}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          variant === 'secondary' && styles.labelSecondary,
          variant === 'danger' && styles.labelDanger,
          variant === 'primary' && styles.labelPrimary,
          isDisabled && styles.labelDisabled,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: {backgroundColor: colors.accent},
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: {backgroundColor: colors.danger},
  disabled: {
    backgroundColor: colors.segmentTrack,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.85,
  },
  pressed: {opacity: 0.85},
  label: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  labelPrimary: {color: '#fff'},
  labelSecondary: {color: colors.accent},
  labelDanger: {color: '#fff'},
  labelDisabled: {color: colors.muted},
});