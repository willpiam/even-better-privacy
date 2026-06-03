import React from 'react';
import {ActivityIndicator, Modal, StyleSheet, Text, View} from 'react-native';

export default function BusyOverlay({
  visible,
  message = 'Working...',
}: {
  visible: boolean;
  message?: string;
}): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.box}>
          <ActivityIndicator size="large" color="#1a5fb4" />
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 200,
  },
  message: {
    marginTop: 14,
    color: '#111',
    fontSize: 15,
    textAlign: 'center',
  },
});
