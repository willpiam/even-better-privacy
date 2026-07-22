import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Button,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {listContacts, type StoredContact} from '../services/contacts';
import {
  contactSearchHaystack,
  storedContactToLike,
} from '../services/contactDisplay';
import ContactListRow from './ContactListRow';

type Props = {
  visible: boolean;
  email: string;
  /** When set (ambiguous match), these contacts are shown first with empty search. */
  preferredContacts?: StoredContact[];
  onCancel: () => void;
  onSelectContact: (name: string) => void;
  onMarkUnencrypted: () => void;
};

export default function RecipientResolveModal({
  visible,
  email,
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
          <Text style={styles.title}>No matching EBP contact</Text>
          <Text style={styles.body}>
            No contact has {email || 'this address'} as an email or opaque email
            detail. Select a contact to encrypt for, or send without encryption.
          </Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search contacts..."
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search contacts"
          />
          <FlatList
            data={filtered}
            keyExtractor={item => item.name}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>No contacts match this search.</Text>
            }
            renderItem={({item}) => (
              <ContactListRow
                contact={storedContactToLike(item)}
                showAvatar={false}
                showChevron={false}
                onPress={() => onSelectContact(item.name)}
              />
            )}
          />
          <Button
            title="This email is not intended to be encrypted"
            onPress={onMarkUnencrypted}
            color="#b00020"
          />
          <View style={styles.cancelRow}>
            <Button title="Cancel" onPress={onCancel} />
          </View>
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
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  title: {fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8},
  body: {fontSize: 13, color: '#444', marginBottom: 10},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
    marginBottom: 8,
  },
  list: {maxHeight: 240, marginBottom: 12},
  empty: {padding: 12, color: '#666', fontSize: 13},
  cancelRow: {marginTop: 8},
});
