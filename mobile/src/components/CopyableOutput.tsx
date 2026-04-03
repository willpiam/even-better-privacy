import React from 'react';
import {Button, StyleSheet, TextInput, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

export default function CopyableOutput({
  value,
  placeholder,
}: {
  value: string;
  placeholder?: string;
}): JSX.Element {
  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        value={value}
        editable={false}
        multiline
        placeholder={placeholder}
      />
      <Button title="Copy" onPress={() => Clipboard.setString(value || '')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: 8, marginBottom: 8},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    minHeight: 110,
    textAlignVertical: 'top',
    padding: 10,
    color: '#111',
    marginBottom: 8,
  },
});
