import React, {useMemo, useRef, useState} from 'react';
import {Animated, PanResponder, StyleSheet, Text, View} from 'react-native';
import {MailIcon} from './MailAppearance';

export type MailSwipeAction = 'archive' | 'delete';
export default function SwipeMailRow({
  children,
  onAction,
  disabled,
}: {
  children: React.ReactNode;
  onAction: (action: MailSwipeAction) => Promise<void>;
  disabled: boolean;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  const [action, setAction] = useState<MailSwipeAction>('archive');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const latest = useRef({onAction, disabled});
  latest.current = {onAction, disabled};
  const responder = useMemo(() => {
    const reset = () =>
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: true,
        overshootClamping: true,
      }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !latest.current.disabled &&
        !pending.current &&
        Math.abs(g.dx) > 12 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => offset.stopAnimation(),
      onPanResponderMove: (_, g) => {
        offset.setValue(g.dx);
        setAction(g.dx < 0 ? 'delete' : 'archive');
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) < 96) {
          reset();
          return;
        }
        pending.current = true;
        setBusy(true);
        void latest.current
          .onAction(g.dx < 0 ? 'delete' : 'archive')
          .finally(() => {
            pending.current = false;
            setBusy(false);
            reset();
          });
      },
      onPanResponderTerminate: reset,
      onPanResponderTerminationRequest: () => !pending.current,
    });
  }, [offset]);
  return (
    <View style={styles.container}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.background,
          action === 'delete' ? styles.delete : styles.archive,
          action === 'delete' ? styles.right : styles.left,
        ]}>
        <MailIcon name={action} color="#ffffff" />
        <Text style={styles.label}>
          {busy ? 'Moving…' : action === 'delete' ? 'Delete' : 'Archive'}
        </Text>
      </View>
      <Animated.View
        {...responder.panHandlers}
        style={{transform: [{translateX: offset}]}}
        pointerEvents={busy ? 'none' : 'auto'}>
        {children}
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {overflow: 'hidden'},
  background: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    gap: 6,
  },
  archive: {backgroundColor: '#285e47'},
  delete: {backgroundColor: '#b83232'},
  left: {alignItems: 'flex-start', paddingLeft: 20},
  right: {alignItems: 'flex-end', paddingRight: 20},
  label: {color: '#ffffff', fontWeight: '700', fontSize: 13},
});
