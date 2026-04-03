import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {listContacts, type StoredContact} from '../services/contacts';

export default function ContactPicker({
  value,
  onChange,
  placeholder = 'Search contacts...',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  useEffect(() => {
    void (async () => setContacts(await listContacts()))();
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) {
      return contacts;
    }
    return contacts.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        item.contact.fingerprint.toLowerCase().includes(q),
    );
  }, [contacts, value]);

  return (
    <View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
      />
      <FlatList
        data={filtered.slice(0, 6)}
        keyExtractor={item => item.name}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => onChange(item.name)}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.fp}>{item.contact.fingerprint}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    color: '#111',
  },
  item: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 8,
    marginBottom: 4,
  },
  name: {fontWeight: '700', color: '#111'},
  fp: {fontSize: 11, color: '#333', marginTop: 2},
});
