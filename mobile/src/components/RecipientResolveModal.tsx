import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Modal, StyleSheet, Text, View} from 'react-native';
import {listContacts, type StoredContact} from '../services/contacts';
import {
  contactSearchHaystack,
  storedContactToLike,
} from '../services/contactDisplay';
import ContactListRow from './ContactListRow';
import AppButton from './AppButton';
import TextField from './TextField';
import {colors, layout, radius, spacing, typography} from '../theme/tokens';

type Props = {
  visible: boolean;
  email: string;
  /** Overrides the "no matching contact" heading when re-opening a resolved recipient. */
  title?: string;
  /** When set (ambiguous match), these contacts are shown first with empty search. */
  preferredContacts?: StoredContact[];
  onCancel: () => void;
  onSelectContact: (name: string) => void;
  onMarkUnencrypted: () => void;
};

export default function RecipientResolveModal({
  visible,
  email,
  title,
  preferredContacts,
  onCancel,
  onSelectContact,
  onMarkUnencrypted,
}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [query, setQuery] = useState('');

  const loadContacts = useCallback(async () => {
    setContacts(await listContacts());
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setQuery('');
    void loadContacts();
  }, [visible, loadContacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const preferredNames = new Set(
      (preferredContacts ?? []).map(c => c.name),
    );
    let pool = contacts;
    if (!q && preferredNames.size > 0) {
      pool = [
        ...contacts.filter(c => preferredNames.has(c.name)),
        ...contacts.filter(c => !preferredNames.has(c.name)),
      ];
    }
    if (!q) {
      return pool;
    }
    return pool.filter(item =>
      contactSearchHaystack(storedContactToLike(item)).includes(q),
    );
  }, [contacts, preferredContacts, query]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>{title ?? 'No matching EBP contact'}</Text>
          <Text style={styles.body}>
            {title
              ? `Select a contact to encrypt ${email || 'this address'} for, or send to it without encryption.`
              : `No contact has ${email || 'this address'} as an email or opaque email detail. Select a contact to encrypt for, or send without encryption.`}
          </Text>
          <TextField
            label="Search contacts"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={filtered}
            keyExtractor={item => item.name}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>No contacts match this search.</Text>
            }
            renderItem={({item, index}) => (
              <ContactListRow
                contact={storedContactToLike(item)}
                showAvatar={false}
                showChevron={false}
                showDivider={index < filtered.length - 1}
                onPress={() => onSelectContact(item.name)}
              />
            )}
          />
          <AppButton
            title="This email is not intended to be encrypted"
            onPress={onMarkUnencrypted}
            variant="danger"
          />
          <AppButton title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: layout.gutter,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: layout.gutter,
    gap: spacing.sm,
  },
  title: {fontSize: typography.title, fontWeight: '700', color: colors.text},
  body: {fontSize: typography.caption, color: colors.muted},
  list: {maxHeight: 240, marginHorizontal: -layout.gutter},
  empty: {
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.md,
    color: colors.muted,
    fontSize: typography.caption,
  },
});
