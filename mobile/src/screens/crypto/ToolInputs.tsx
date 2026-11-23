import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AppButton from '../../components/AppButton';
import AppIcon from '../../components/AppIcon';
import ContactPicker from '../../components/ContactPicker';
import StatusBanner from '../../components/StatusBanner';
import TextField from '../../components/TextField';
import {usePlaceTheme} from '../../theme/PlaceTheme';
import {colors, radius, spacing, typography} from '../../theme/tokens';
import {ToolDisclosure, ToolHint} from './ToolForm';
import {
  pickToolFile,
  readToolTextFile,
  removeToolFile,
  type ToolFile,
} from './toolFiles';
import type {ToolAction} from './useToolAction';

export function ToolImportField({
  action,
  label,
  placeholder,
  value,
  onChange,
  pasteMessage,
  testID,
  pasteTestID,
}: {
  action: ToolAction;
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  pasteMessage: string;
  testID?: string;
  pasteTestID?: string;
}) {
  const [fileName, setFileName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const disabled = action.pending !== null;

  const paste = () =>
    action.perform(
      'input',
      async () => {
        setError('');
        setNotice('');
        const text = await Clipboard.getString();
        if (!text.trim()) {
          throw new Error(
            'Clipboard is empty. Copy the text first or choose a file.',
          );
        }
        setFileName('');
        onChange(text);
        setNotice(pasteMessage);
      },
      setError,
    );

  const importFile = () =>
    action.perform(
      'input',
      async () => {
        setError('');
        const file = await readToolTextFile();
        if (file) {
          setNotice('');
          setFileName(file.name);
          onChange(file.text);
        }
      },
      setError,
    );

  return (
    <View style={styles.group}>
      {fileName ? (
        <View style={styles.selection}>
          <AppIcon name="file" />
          <View style={styles.fileText}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value} numberOfLines={2}>
              {fileName}
            </Text>
          </View>
        </View>
      ) : (
        <TextField
          label={label}
          value={value}
          onChangeText={text => {
            onChange(text);
            setNotice('');
            setError('');
          }}
          placeholder={placeholder}
          testID={testID}
          editable={!disabled}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
      )}
      <View style={styles.actions}>
        <AppButton
          title="Paste"
          accessibilityLabel={`Paste ${label.toLowerCase()}`}
          testID={pasteTestID}
          variant="secondary"
          disabled={disabled}
          onPress={paste}
          style={styles.action}
        />
        <AppButton
          title="Import file"
          accessibilityLabel={`Import ${label.toLowerCase()} from a file`}
          variant="secondary"
          disabled={disabled}
          onPress={importFile}
          style={styles.action}
        />
      </View>
      {fileName ? (
        <AppButton
          title="Enter text instead"
          variant="secondary"
          disabled={disabled}
          onPress={() => {
            setFileName('');
            setError('');
            setNotice('');
            onChange('');
          }}
        />
      ) : null}
      {notice && !error ? <StatusBanner message={notice} /> : null}
      {error ? <StatusBanner kind="error" message={error} /> : null}
    </View>
  );
}

export function ToolFileInput({
  action,
  label,
  file,
  onPick,
  nameTestID,
  overridden,
}: {
  action: ToolAction;
  label: string;
  file: ToolFile | null;
  onPick: (file: ToolFile) => void;
  nameTestID: string;
  overridden: boolean;
}) {
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const {accent} = usePlaceTheme();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (file) removeToolFile(file.uri);
    };
  }, [file]);

  return (
    <View style={styles.group}>
      <View style={styles.selection}>
        <AppIcon name="file" color={accent} />
        <View style={styles.fileText}>
          <Text style={styles.label}>{label}</Text>
          <Text testID={nameTestID} style={styles.value} numberOfLines={2}>
            {overridden
              ? 'Using a manually entered URI'
              : file?.name ?? 'No file selected'}
          </Text>
        </View>
      </View>
      <AppButton
        title={file || overridden ? 'Change file' : 'Choose file'}
        variant="secondary"
        disabled={action.pending !== null}
        onPress={() =>
          action.perform(
            'input',
            async () => {
              setError('');
              const selected = await pickToolFile();
              if (selected) {
                if (mounted.current) {
                  onPick(selected);
                } else {
                  removeToolFile(selected.uri);
                }
              }
            },
            setError,
          )
        }
      />
      {error ? <StatusBanner kind="error" message={error} /> : null}
    </View>
  );
}

export function ToolFileOptions({
  uri,
  onChange,
  disabled,
  children,
}: {
  uri: string;
  onChange: (uri: string) => void;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  return (
    <ToolDisclosure label="File options" disabled={disabled}>
      <TextField
        label="File URI (optional)"
        keyboardType="url"
        autoCorrect={false}
        spellCheck={false}
        value={uri}
        onChangeText={onChange}
        placeholder="file:///…"
        autoCapitalize="none"
        editable={!disabled}
      />
      <ToolHint>A file URI overrides the file chosen above.</ToolHint>
      {children}
    </ToolDisclosure>
  );
}

export function ToolContact({
  sender = false,
  value,
  onChange,
  disabled,
}: {
  sender?: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const field = (
    <View style={styles.group}>
      <ContactPicker
        label={
          sender
            ? 'Sender name or fingerprint'
            : 'Recipient name or fingerprint'
        }
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder="Contact name or fingerprint"
      />
      <ToolHint>
        {sender
          ? 'Provide the sender if the app cannot find their signing key automatically.'
          : 'Search your saved contacts by name or fingerprint.'}
      </ToolHint>
    </View>
  );

  return sender ? (
    <ToolDisclosure
      label={value.trim() ? `Sender · ${value.trim()}` : 'Sender (optional)'}
      disabled={disabled}>
      {field}
    </ToolDisclosure>
  ) : (
    <View style={styles.group}>
      <Text style={styles.label}>Recipient</Text>
      {field}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {gap: spacing.sm},
  actions: {flexDirection: 'row', gap: spacing.sm},
  action: {flex: 1},
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fileText: {flex: 1, gap: spacing.xs},
  label: {color: colors.muted, fontSize: typography.caption, fontWeight: '600'},
  value: {color: colors.text, fontSize: typography.body},
});
