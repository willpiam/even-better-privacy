import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, layout, radius, spacing, typography} from '../theme/tokens';
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
  /** Hairline under the row. Hide it on the last row of a group. */
  showDivider?: boolean;
  testID?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  const hasLeading = Boolean(avatarText || icon);
  const content = (
    <>
      {hasLeading ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.avatar,
            icon && styles.iconTile,
            {backgroundColor: theme.pale},
          ]}>
          {icon ? (
            <AppIcon name={icon} color={theme.accent} size={20} />
          ) : (
            <Text
              maxFontSizeMultiplier={1.3}
              style={[styles.avatarText, {color: theme.accent}]}>
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
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {badge ? (
          <Text
            style={[
              styles.badge,
              {backgroundColor: theme.pale, color: theme.accent},
              badgeVariant === 'danger' && styles.badgeDanger,
            ]}>
            {badge}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron && onPress ? (
        <AppIcon name="chevron" color={colors.muted} size={16} />
      ) : null}
      {showDivider ? (
        <View style={[styles.divider, hasLeading && styles.leadingDivider]} />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        style={({pressed}) => [
          styles.row,
          pressed && {backgroundColor: theme.soft},
        ]}>
        {content}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={styles.row}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.controlHeight,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.gutter,
    backgroundColor: colors.surface,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    start: layout.gutter,
    end: layout.gutter,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  leadingDivider: {
    start: layout.gutter + layout.avatarSize + spacing.md,
  },
  avatar: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: layout.avatarSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: {borderRadius: radius.sm},
  avatarText: {
    fontWeight: '700',
    fontSize: typography.caption,
  },
  meta: {flex: 1, minWidth: 0, gap: spacing.xs},
  title: {
    fontWeight: '600',
    fontSize: typography.row,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.caption,
    color: colors.muted,
  },
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    fontSize: typography.tab,
    fontWeight: '700',
  },
  badgeDanger: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
});
