import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme/tokens';

export default function ListRow({
  title,
  subtitle,
  avatarText,
  badge,
  onPress,
  showChevron = true,
  right,
}: {
  title: string;
  subtitle?: string;
  avatarText?: string;
  badge?: string;
  onPress?: () => void;
  showChevron?: boolean;
  right?: React.ReactNode;
}): JSX.Element {
  const content = (
    <>
      {avatarText ? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarText.slice(0, 1).toUpperCase()}</Text>
        </View>
      ) : null}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {right}
      {showChevron && onPress ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({pressed}) => [styles.row, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }

  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {backgroundColor: colors.accentSoft},
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.muted,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  chevron: {
    color: '#ccc',
    fontSize: 18,
  },
});
