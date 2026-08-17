import React, {useCallback, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
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
  /** What to write into `value` when a contact is selected. Default: storage name. */
  selectValue?: 'name' | 'fingerprint';
  testID?: string;
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

function selectedValue(
  item: StoredContact,
  selectValue: 'name' | 'fingerprint',
): string {
  return selectValue === 'fingerprint' ? item.contact.fingerprint : item.name;
}

function findSelected(
  contacts: StoredContact[],
  value: string,
  selectValue: 'name' | 'fingerprint',
): StoredContact | undefined {
  if (!value) {
    return undefined;
  }
  if (selectValue === 'fingerprint') {
    return contacts.find(
      c =>
        c.contact.fingerprint === value ||
        c.contact.fingerprint.startsWith(value),
    );
  }
  return contacts.find(c => c.name === value);
}

function ResultsList({
  items,
  value,
  selectValue,
  onPick,
}: {
  items: StoredContact[];
  value: string;
  selectValue: 'name' | 'fingerprint';
  onPick: (next: string) => void;
}): JSX.Element {
  if (items.length === 0) {
    return (
      <View style={styles.resultsList}>
        <Text style={styles.empty}>No matching contacts</Text>
      </View>
    );
  }
  return (
    <View style={styles.resultsList}>
      <ScrollView
        style={styles.resultsScroll}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled">
        {items.map((item, index) => {
          const next = selectedValue(item, selectValue);
          const isSelected = next === value;
          const isLast = index === items.length - 1;
          return (
            <TouchableOpacity
              key={item.name}
              style={[
                styles.item,
                !isLast && styles.itemDivider,
                isSelected && styles.itemSelected,
              ]}
              onPress={() => onPick(next)}>
              <ContactPickerLabels item={item} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function ContactPicker({
  value,
  onChange,
  placeholder = 'Search contacts...',
  variant = 'search',
  selectValue = 'name',
  testID,
}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

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
    const selected = findSelected(contacts, value, selectValue);
    const selectedLabels = selected
      ? resolveContactLabels(storedContactToLike(selected))
      : null;
    return (
      <View style={styles.wrap}>
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
          contacts.length === 0 ? (
            <View style={styles.resultsList}>
              <Text style={styles.empty}>
                No contacts yet. Add contacts on the Contacts screen.
              </Text>
            </View>
          ) : (
            <ResultsList
              items={contacts}
              value={value}
              selectValue={selectValue}
              onPick={next => {
                onChange(next);
                setOpen(false);
              }}
            />
          )
        ) : null}
      </View>
    );
  }

  const showResults = focused;

  return (
    <View style={styles.wrap}>
      <TextInput
        testID={testID}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Defer so a result tap can register before the list unmounts.
          setTimeout(() => setFocused(false), 150);
        }}
      />
      {showResults ? (
        <ResultsList
          items={filtered.slice(0, 8)}
          value={value}
          selectValue={selectValue}
          onPick={next => {
            onChange(next);
            setFocused(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 4},
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
  resultsList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  resultsScroll: {maxHeight: 220},
  empty: {padding: 12, color: colors.muted, fontSize: 13},
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  item: {
    padding: 10,
  },
  itemDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemSelected: {backgroundColor: colors.accentSoft},
  name: {fontWeight: '700', color: colors.text},
  fp: {fontSize: 11, color: colors.muted, marginTop: 2},
});
