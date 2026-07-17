import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Button,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getDetailValue,
  listContacts,
  type StoredContact,
} from '../services/contacts';

type Props = {
  visible: boolean;
  email: string;
  /** When set (ambiguous match), these contacts are shown first with empty search. */
  preferredContacts?: StoredContact[];
  onCancel: () => void;
  onSelectContact: (name: string) => void;
  onMarkUnencrypted: () => void;
};

function contactSearchHaystack(item: StoredContact): string {
  const detailEmail = getDetailValue(item.contact.details, 'email') ?? '';
  const resolvedOpaque =
    item.contact.resolvedOpaqueDetails?.['opaque::email'] ?? '';
  return [
    item.name,
    item.contact.fingerprint,
    detailEmail,
    resolvedOpaque,
  ]
    .join(' ')
    .toLowerCase();
}

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
    return pool.filter(item => contactSearchHaystack(item).includes(q));
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
              <TouchableOpacity
                style={styles.item}
                onPress={() => onSelectContact(item.name)}
                accessibilityRole="button"
                accessibilityLabel={`Select contact ${item.name}`}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.fp} numberOfLines={1}>
                  {item.contact.fingerprint}
                </Text>
              </TouchableOpacity>
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
  item: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  name: {fontWeight: '700', color: '#111'},
  fp: {fontSize: 11, color: '#333', marginTop: 2},
  cancelRow: {marginTop: 8},
});
