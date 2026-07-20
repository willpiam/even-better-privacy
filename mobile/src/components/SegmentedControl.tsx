import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, typography} from '../theme/tokens';

export default function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: {label: string; value: string}[];
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <View style={styles.track}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.item, active && styles.itemActive]}>
            <Text style={[styles.label, active && styles.labelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.segmentTrack,
    borderRadius: radius.sm + 1,
    padding: 2,
  },
  item: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 7,
    alignItems: 'center',
  },
  itemActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.muted,
  },
  labelActive: {
    fontWeight: '600',
    color: colors.text,
    fontSize: typography.caption + 1,
  },
});
