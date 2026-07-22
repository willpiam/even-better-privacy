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
import {
  contactSearchHaystack,
  resolveContactLabels,
  storedContactToLike,
} from '../services/contactDisplay';

import {colors} from '../theme/tokens';

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  variant?: 'search' | 'dropdown';
};

function ContactPickerLabels({item}: {item: StoredContact}): JSX.Element {
  const {primary, secondary} = resolveContactLabels(storedContactToLike(item));
  return (
    <>
      <Text style={styles.name}>{primary}</Text>
      <Text style={styles.fp} numberOfLines={1}>
        {secondary}
      </Text>
    </>
  );
}

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
    return contacts.filter(item =>
      contactSearchHaystack(storedContactToLike(item)).includes(q),
    );
  }, [contacts, value]);

  if (variant === 'dropdown') {
    const selected = contacts.find(c => c.name === value);
    const selectedLabels = selected
      ? resolveContactLabels(storedContactToLike(selected))
      : null;
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
              {value
                ? (selectedLabels?.primary ?? value)
                : placeholder}
            </Text>
            {selectedLabels ? (
              <Text style={styles.fp} numberOfLines={1}>
                {selectedLabels.secondary}
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
                      <ContactPickerLabels item={item} />
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
            <ContactPickerLabels item={item} />
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
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  dropdownTriggerText: {flex: 1, marginRight: 8},
  selectedLabel: {color: colors.text, fontSize: 15},
  placeholderLabel: {color: '#999', fontSize: 15},
  chevron: {color: colors.muted, fontSize: 12},
  dropdownList: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.page,
    overflow: 'hidden',
  },
  dropdownScroll: {maxHeight: 220},
  empty: {padding: 12, color: colors.muted, fontSize: 13},
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 10,
  },
  itemSelected: {backgroundColor: colors.accentSoft},
  name: {fontWeight: '700', color: colors.text},
  fp: {fontSize: 11, color: colors.muted, marginTop: 2},
});
