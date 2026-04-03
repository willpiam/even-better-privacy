import React, {useState} from 'react';
import {
  Button,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function PasswordModal({
  visible,
  title = 'Enter Password',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title?: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
          />
          <View style={styles.row}>
            <Button title="Cancel" onPress={onCancel} />
            <Button
              title="Submit"
              onPress={() => {
                onSubmit(password);
                setPassword('');
              }}
            />
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
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  title: {fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
    marginBottom: 10,
  },
  row: {flexDirection: 'row', justifyContent: 'space-between'},
});
