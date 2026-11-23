import React, {useCallback, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import AppButton from '../../components/AppButton';
import AppIcon from '../../components/AppIcon';
import Screen from '../../components/Screen';
import StatusBanner from '../../components/StatusBanner';
import {getCurrentIdentity} from '../../services/storage';
import {usePlaceTheme} from '../../theme/PlaceTheme';
import {colors, layout, radius, spacing, typography} from '../../theme/tokens';
import type {ToolAction} from './useToolAction';

export function ToolForm({
  description,
  action,
  title,
  busyTitle,
  onSubmit,
  disabled,
  testID,
  result,
  children,
}: {
  description: string;
  action: ToolAction;
  title: string;
  busyTitle?: string;
  onSubmit: () => void;
  disabled: boolean;
  testID?: string;
  result?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scroll = useRef<ScrollView>(null);
  const submitting = action.pending === 'submit';
  return (
    <Screen scroll scrollRef={scroll}>
      <ToolHint>{description}</ToolHint>
      {children}
      <AppButton
        title={submitting ? busyTitle ?? title : title}
        testID={testID}
        disabled={disabled || action.pending !== null}
        loading={submitting}
        onPress={onSubmit}
      />
      {action.error || result ? (
        <View
          onLayout={({nativeEvent}) => {
            scroll.current?.scrollTo({
              y: Math.max(0, nativeEvent.layout.y - spacing.md),
            });
          }}>
          {action.error ? (
            <StatusBanner kind="error" message={action.error} />
          ) : (
            result
          )}
        </View>
      ) : null}
    </Screen>
  );
}

export function ToolHint({children}: {children: React.ReactNode}) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function ToolIdentity({verb}: {verb: 'Signing' | 'Decrypting'}) {
  const [identity, setIdentity] = useState<string | null>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCurrentIdentity().then(
        name => {
          if (active) setIdentity(name);
        },
        () => {
          if (active) setIdentity(null);
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );
  const {pale, accent} = usePlaceTheme();
  return (
    <View style={[styles.identity, {backgroundColor: pale}]}>
      <AppIcon name="key" size={18} color={accent} />
      <Text style={[styles.identityText, {color: accent}]}>
        {identity === undefined
          ? 'Checking current identity…'
          : identity
          ? `${verb} with ${identity}`
          : 'Choose a current identity in Identities first.'}
      </Text>
    </View>
  );
}

export function ToolDisclosure({
  label,
  children,
  disabled,
  testID,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  testID?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const {accent} = usePlaceTheme();
  return (
    <View style={styles.group}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{expanded, disabled: !!disabled}}
        disabled={disabled}
        onPress={() => setExpanded(open => !open)}
        style={styles.option}>
        <Text style={[styles.optionTitle, {color: accent}]}>{label}</Text>
        <View style={expanded ? styles.up : styles.down}>
          <AppIcon name="chevron" size={16} color={accent} />
        </View>
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

export function ToolToggle({
  label,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const {accent} = usePlaceTheme();
  return (
    <View style={styles.option}>
      <View style={styles.optionDescription}>
        <Text style={styles.optionTitle}>{label}</Text>
        <ToolHint>{hint}</ToolHint>
      </View>
      <Switch
        testID={testID}
        value={value}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{true: accent}}
        onValueChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {color: colors.muted, fontSize: typography.caption, lineHeight: 19},
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    gap: spacing.sm,
    padding: spacing.md,
  },
  identityText: {flex: 1, fontSize: typography.caption, fontWeight: '600'},
  group: {gap: spacing.sm},
  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  optionDescription: {flex: 1, gap: spacing.xs},
  optionTitle: {
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  up: {transform: [{rotate: '-90deg'}]},
  down: {transform: [{rotate: '90deg'}]},
});
