import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, layout, radius, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';

export default function SegmentedControl({
  options,
  value,
  onChange,
  testID,
}: {
  options: {label: string; value: string}[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}): JSX.Element {
  const theme = usePlaceTheme();
  return (
    <View style={styles.track} testID={testID}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={testID ? `${testID}-${option.value}` : undefined}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            style={({pressed}) => [
              styles.item,
              active && {backgroundColor: theme.pale},
              !active && pressed && {backgroundColor: theme.soft},
            ]}>
            <Text
              style={[
                styles.label,
                active && styles.labelActive,
                active && {color: theme.accent},
              ]}>
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
    borderRadius: radius.sm,
    padding: 2,
  },
  item: {
    flex: 1,
    minHeight: layout.controlHeight - 4,
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.sm - 2,
    alignItems: 'center',
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '500',
    color: colors.muted,
  },
  labelActive: {fontWeight: '700'},
});
