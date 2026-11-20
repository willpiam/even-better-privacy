import React from 'react';
import ListRow from './ListRow';
import {
  resolveContactLabels,
  type ContactLike,
} from '../services/contactDisplay';

export default function ContactListRow({
  contact,
  onPress,
  showChevron = true,
  badge,
  badgeVariant = 'default',
  right,
  showAvatar = true,
  showDivider,
  subtitleExtra,
  testID,
}: {
  contact: ContactLike;
  onPress?: () => void;
  showChevron?: boolean;
  badge?: string;
  badgeVariant?: 'default' | 'danger';
  right?: React.ReactNode;
  showAvatar?: boolean;
  showDivider?: boolean;
  /** Appended after secondary with ` · ` (e.g. browse key types · created). */
  subtitleExtra?: string;
  testID?: string;
}): JSX.Element {
  const {primary, secondary} = resolveContactLabels(contact);
  const subtitle = subtitleExtra
    ? [secondary, subtitleExtra].filter(Boolean).join(' · ')
    : secondary;

  return (
    <ListRow
      testID={testID}
      title={primary}
      subtitle={subtitle}
      avatarText={showAvatar ? primary : undefined}
      onPress={onPress}
      showChevron={showChevron}
      showDivider={showDivider}
      badge={badge}
      badgeVariant={badgeVariant}
      right={right}
    />
  );
}
