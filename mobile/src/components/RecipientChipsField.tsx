import React, {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import RecipientResolveModal from './RecipientResolveModal';
import {
  findContactsByEmail,
  resolveVerifiedRecipient,
} from '../services/contacts';
import {
  appendAddresses,
  applyResolution,
  resolveChipAddress,
  splitPendingInput,
  type RecipientChip,
} from '../services/mail/recipientChipsLogic';
import {colors, radius, spacing, typography} from '../theme/tokens';

type Props = {
  chips: RecipientChip[];
  onChange: React.Dispatch<React.SetStateAction<RecipientChip[]>>;
};

const STATE_LABEL: Record<RecipientChip['state'], string> = {
  resolving: 'looking up',
  encrypted: 'encrypted',
  unresolved: 'needs a contact',
  plaintext: 'unencrypted',
  invalid: 'invalid address',
};

export default function RecipientChipsField({
  chips,
  onChange,
}: Props): JSX.Element {
  const [draft, setDraft] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    for (const chip of chips) {
      if (chip.state !== 'resolving' || inFlight.current.has(chip.id)) {
        continue;
      }
      inFlight.current.add(chip.id);
      const {id, email} = chip;
      void resolveChipAddress(email, {
        resolveVerifiedRecipient,
        findContactsByEmail,
      }).then(resolution => {
        inFlight.current.delete(id);
        onChange(prev => applyResolution(prev, id, email, resolution));
      });
    }
  }, [chips, onChange]);

  const commit = (text: string) => {
    if (text.trim()) {
      onChange(prev => appendAddresses(prev, text));
    }
  };

  const onChangeText = (text: string) => {
    const {complete, rest} = splitPendingInput(text);
    if (complete) {
      commit(complete);
    }
    setDraft(rest);
  };

  const flushDraft = () => {
    commit(draft);
    setDraft('');
  };

  const removeChip = (id: string) =>
    onChange(prev => prev.filter(chip => chip.id !== id));

  const updateChip = (id: string, patch: Partial<RecipientChip>) =>
    onChange(prev =>
      prev.map(chip => (chip.id === id ? {...chip, ...patch} : chip)),
    );

  const onChipPress = (chip: RecipientChip) => {
    if (chip.state === 'resolving') {
      return;
    }
    if (chip.state === 'invalid') {
      removeChip(chip.id);
      setDraft(chip.email);
      return;
    }
    setResolveId(chip.id);
  };

  const resolving = chips.find(chip => chip.id === resolveId);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>To</Text>
      <View style={styles.chipRow}>
        {chips.map(chip => (
          <View
            key={chip.id}
            style={[styles.chip, chipStyles[chip.state]]}
            testID={`recipient-chip-${chip.email}`}>
            <Pressable
              onPress={() => onChipPress(chip)}
              accessibilityRole="button"
              accessibilityLabel={`Recipient ${chip.email}, ${STATE_LABEL[chip.state]}`}
              style={styles.chipLabelWrap}>
              <Text
                style={[styles.chipText, chipTextStyles[chip.state]]}
                numberOfLines={1}>
                {chip.state === 'encrypted' && chip.contact
                  ? `🔒 ${chip.contact} <${chip.email}>`
                  : chip.email}
              </Text>
              <Text style={[styles.chipState, chipTextStyles[chip.state]]}>
                {STATE_LABEL[chip.state]}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => removeChip(chip.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${chip.email}`}
              hitSlop={8}>
              <Text style={[styles.remove, chipTextStyles[chip.state]]}>×</Text>
            </Pressable>
          </View>
        ))}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onChangeText}
          onSubmitEditing={flushDraft}
          onBlur={flushDraft}
          onKeyPress={({nativeEvent}) => {
            if (nativeEvent.key === 'Backspace' && !draft && chips.length) {
              removeChip(chips[chips.length - 1].id);
            }
          }}
          blurOnSubmit={false}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="done"
          placeholder={chips.length ? 'Add another' : 'recipient@example.com'}
          placeholderTextColor="#aaa"
          accessibilityLabel="To email addresses"
          testID="compose-to-input"
        />
      </View>
      {chips.some(chip => chip.note) ? (
        <Text style={styles.note}>
          {chips
            .filter(chip => chip.note)
            .map(chip => `${chip.email}: ${chip.note}`)
            .join('\n')}
        </Text>
      ) : null}
      <RecipientResolveModal
        visible={resolving !== undefined}
        email={resolving?.email ?? ''}
        title={
          resolving?.state === 'encrypted'
            ? `Encrypting for ${resolving.contact}`
            : resolving?.state === 'plaintext'
              ? 'Sending unencrypted'
              : undefined
        }
        preferredContacts={resolving?.preferredContacts}
        onCancel={() => setResolveId(null)}
        onSelectContact={name => {
          if (resolveId) {
            updateChip(resolveId, {
              state: 'encrypted',
              contact: name,
              note: undefined,
            });
          }
          setResolveId(null);
        }}
        onMarkUnencrypted={() => {
          if (resolveId) {
            updateChip(resolveId, {
              state: 'plaintext',
              contact: undefined,
              note: undefined,
            });
          }
          setResolveId(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipLabelWrap: {
    flexShrink: 1,
  },
  chipText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  chipState: {
    fontSize: 10,
  },
  remove: {
    fontSize: 16,
    fontWeight: '700',
  },
  input: {
    flexGrow: 1,
    minWidth: 140,
    fontSize: typography.body,
    color: colors.text,
    padding: 0,
    minHeight: 24,
  },
  note: {
    marginTop: 6,
    fontSize: typography.caption,
    color: colors.muted,
  },
});

const chipStyles = StyleSheet.create({
  resolving: {borderColor: colors.border, backgroundColor: colors.page},
  encrypted: {borderColor: colors.success, backgroundColor: colors.successSoft},
  unresolved: {borderColor: '#b7791f', backgroundColor: '#fdf3e1'},
  plaintext: {borderColor: colors.danger, backgroundColor: colors.dangerSoft},
  invalid: {borderColor: colors.danger, backgroundColor: colors.dangerSoft},
});

const chipTextStyles = StyleSheet.create({
  resolving: {color: colors.muted},
  encrypted: {color: colors.success},
  unresolved: {color: '#8a5a00'},
  plaintext: {color: colors.danger},
  invalid: {color: colors.danger, textDecorationLine: 'line-through'},
});
