import React, {useCallback, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {listContacts, type StoredContact} from '../services/contacts';

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  variant?: 'search' | 'dropdown';
};

export default function ContactPicker({
  value,
  onChange,
  placeholder = 'Search contacts...',
  variant = 'search',
}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [open, setOpen] = useState(false);

  const loadContacts = useCallback(async () => {
    setContacts(await listContacts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadContacts();
    }, [loadContacts]),
  );

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

  if (variant === 'dropdown') {
    const selected = contacts.find(c => c.name === value);
    return (
      <View style={styles.dropdownWrap}>
        <TouchableOpacity
          style={styles.dropdownTrigger}
          onPress={() => setOpen(wasOpen => !wasOpen)}
          accessibilityLabel="EBP contact"
          accessibilityRole="button"
          accessibilityState={{expanded: open}}>
          <View style={styles.dropdownTriggerText}>
            <Text
              style={value ? styles.selectedLabel : styles.placeholderLabel}>
              {value ? (selected?.name ?? value) : placeholder}
            </Text>
            {selected ? (
              <Text style={styles.fp} numberOfLines={1}>
                {selected.contact.fingerprint}
              </Text>
            ) : null}
          </View>
          <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {open ? (
          <View style={styles.dropdownList}>
            {contacts.length === 0 ? (
              <Text style={styles.empty}>
                No contacts yet. Add contacts on the Contacts screen.
              </Text>
            ) : (
              <ScrollView
                style={styles.dropdownScroll}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled">
                {contacts.map(item => {
                  const isSelected = item.name === value;
                  return (
                    <TouchableOpacity
                      key={item.name}
                      style={[styles.item, isSelected && styles.itemSelected]}
                      onPress={() => {
                        onChange(item.name);
                        setOpen(false);
                      }}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.fp} numberOfLines={1}>
                        {item.contact.fingerprint}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
    );
  }

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
  dropdownWrap: {marginBottom: 12},
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  dropdownTriggerText: {flex: 1, marginRight: 8},
  selectedLabel: {color: '#111', fontSize: 15},
  placeholderLabel: {color: '#999', fontSize: 15},
  chevron: {color: '#666', fontSize: 12},
  dropdownList: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
    overflow: 'hidden',
  },
  dropdownScroll: {maxHeight: 220},
  empty: {padding: 12, color: '#666', fontSize: 13},
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
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    padding: 10,
  },
  itemSelected: {backgroundColor: '#f0f6ff'},
  name: {fontWeight: '700', color: '#111'},
  fp: {fontSize: 11, color: '#333', marginTop: 2},
});
