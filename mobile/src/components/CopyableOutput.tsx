import React from 'react';
import {StyleSheet, TextInput, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AppButton from './AppButton';
import {colors, radius} from '../theme/tokens';

export default function CopyableOutput({
  value,
  placeholder,
  testID,
  showCopyButton = true,
}: {
  value: string;
  placeholder?: string;
  testID?: string;
  showCopyButton?: boolean;
}): JSX.Element {
  const hasValue = value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      {showCopyButton ? (
        <AppButton
          title="Copy"
          testID={testID ? `${testID}-copy` : undefined}
          variant="secondary"
          disabled={!hasValue}
          onPress={() => {
            if (hasValue) {
              Clipboard.setString(value);
            }
          }}
        />
      ) : null}
      <TextInput
        testID={testID}
        style={[styles.input, !hasValue && styles.inputEmpty]}
        value={value}
        editable={false}
        multiline
        scrollEnabled
        placeholder={placeholder}
        placeholderTextColor={hasValue ? undefined : colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: 8, marginBottom: 8},
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    minHeight: 110,
    maxHeight: 200,
    textAlignVertical: 'top',
    padding: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    marginTop: 8,
  },
  inputEmpty: {
    backgroundColor: colors.page,
    borderColor: colors.border,
    color: colors.muted,
  },
});
