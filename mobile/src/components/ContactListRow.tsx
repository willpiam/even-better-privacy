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
  right,
  showAvatar = true,
  subtitleExtra,
}: {
  contact: ContactLike;
  onPress?: () => void;
  showChevron?: boolean;
  badge?: string;
  right?: React.ReactNode;
  showAvatar?: boolean;
  /** Appended after secondary with ` · ` (e.g. browse key types · created). */
  subtitleExtra?: string;
}): JSX.Element {
  const {primary, secondary} = resolveContactLabels(contact);
  const subtitle = subtitleExtra
    ? [secondary, subtitleExtra].filter(Boolean).join(' · ')
    : secondary;

  return (
    <ListRow
      title={primary}
      subtitle={subtitle}
      avatarText={showAvatar ? primary : undefined}
      onPress={onPress}
      showChevron={showChevron}
      badge={badge}
      right={right}
    />
  );
}
