import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  badgeLabel,
  deriveBadgeKind,
  type AuthenticityBadgeKind,
  type MailAuthenticitySummary,
} from '../services/mail/mailAuthenticity';
import {colors, radius, spacing, typography} from '../theme/tokens';

const KIND_COLORS: Record<
  AuthenticityBadgeKind,
  {fg: string; bg: string}
> = {
  good: {fg: colors.success, bg: colors.successSoft},
  caution: {fg: '#9a6700', bg: '#fff8e6'},
  bad: {fg: colors.danger, bg: colors.dangerSoft},
  neutral: {fg: colors.muted, bg: colors.page},
};

export default function AuthenticityBadge({
  summary,
  onPress,
}: {
  summary: MailAuthenticitySummary;
  onPress: () => void;
}): JSX.Element {
  const kind = deriveBadgeKind(summary);
  const palette = KIND_COLORS[kind];
  const caption =
    summary.verifyStatus === 'unsigned'
      ? 'Unsigned'
      : summary.verifyStatus === 'invalid'
        ? 'Invalid signature'
        : summary.signerMatchesSenderEmail === false
          ? 'Signature valid · From mismatch'
          : summary.signerEmailVerified === false
            ? 'Signature valid · Email unverified'
            : summary.verifyStatus === 'valid_unknown_signer'
              ? 'Valid · Unknown contact'
              : 'Authenticated';

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, {backgroundColor: palette.bg}]}
      accessibilityRole="button"
      accessibilityLabel={`Sender authenticity: ${caption}`}>
      <View style={[styles.glyph, {borderColor: palette.fg}]}>
        <Text style={[styles.glyphText, {color: palette.fg}]}>
          {badgeLabel(kind)}
        </Text>
      </View>
      <Text style={[styles.caption, {color: palette.fg}]} numberOfLines={2}>
        {caption}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  caption: {
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 22,
    color: colors.muted,
  },
});
