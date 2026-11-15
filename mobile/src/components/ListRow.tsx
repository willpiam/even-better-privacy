import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';
import AppIcon, {type IconName} from './AppIcon';

export default function ListRow({
  title,
  subtitle,
  avatarText,
  icon,
  badge,
  badgeVariant = 'default',
  onPress,
  showChevron = true,
  right,
  showDivider = true,
  testID,
}: {
  title: string;
  subtitle?: string;
  avatarText?: string;
  icon?: IconName;
  badge?: string;
  badgeVariant?: 'default' | 'danger';
  onPress?: () => void;
  showChevron?: boolean;
  right?: React.ReactNode;
  /** Hairline under the row. Pass false for the last row in a Card. */
  showDivider?: boolean;
  testID?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  const content = (
    <>
      {avatarText || icon ? (
        <View style={[styles.avatar, {backgroundColor: theme.pale}]}>
          {icon ? (
            <AppIcon name={icon} color={theme.accent} size={20} />
          ) : (
            <Text style={[styles.avatarText, {color: theme.accent}]}>
              {avatarText
                ?.trim()
                .split(/\s+/)
                .map(word => word[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </Text>
          )}
        </View>
      ) : null}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View
          style={[
            styles.badge,
            {backgroundColor: theme.pale},
            badgeVariant === 'danger' && styles.badgeDanger,
          ]}>
          <Text
            style={[
              styles.badgeText,
              {color: theme.accent},
              badgeVariant === 'danger' && styles.badgeTextDanger,
            ]}>
            {badge}
          </Text>
        </View>
      ) : null}
      {right}
      {showChevron && onPress ? (
        <AppIcon name="chevron" color={theme.accent} size={16} />
      ) : null}
    </>
  );

  const rowStyle = [
    styles.row,
    showDivider && styles.divider,
    {borderBottomColor: theme.border},
  ];

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        style={({pressed}) => [
          ...rowStyle,
          pressed && {backgroundColor: theme.soft},
        ]}>
        {content}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={rowStyle}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: spacing.lg + 2,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  meta: {flex: 1, minWidth: 0},
  title: {
    fontWeight: '600',
    fontSize: typography.body,
    color: colors.text,
  },
  subtitle: {
    marginTop: 5,
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.muted,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeDanger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.3,
  },
  badgeTextDanger: {
    color: colors.danger,
  },
});
