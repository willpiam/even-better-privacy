import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import {colors, radius, typography} from '../theme/tokens';
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
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'primary' && {backgroundColor: theme.accent},
        variant === 'secondary' && styles.secondary,
        variant === 'secondary' && {borderColor: theme.border},
        variant === 'danger' && styles.danger,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' ? theme.accent : '#fff'}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          variant === 'secondary' && styles.labelSecondary,
          variant === 'secondary' && {color: theme.accent},
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
    minHeight: 48,
    paddingVertical: 12,
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
  pressed: {opacity: 0.8, transform: [{scale: 0.985}]},
  label: {
    fontSize: typography.body,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  labelPrimary: {color: '#fff'},
  labelSecondary: {color: colors.accent},
  labelDanger: {color: '#fff'},
  labelDisabled: {color: colors.muted},
});
