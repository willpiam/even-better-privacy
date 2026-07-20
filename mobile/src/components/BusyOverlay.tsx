import React from 'react';
import {ActivityIndicator, Modal, StyleSheet, Text, View} from 'react-native';
import {colors, radius} from '../theme/tokens';

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
          <ActivityIndicator size="large" color={colors.accent} />
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 24,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 200,
  },
  message: {
    marginTop: 14,
    color: colors.text,
    fontSize: 15,
    textAlign: 'center',
  },
});
