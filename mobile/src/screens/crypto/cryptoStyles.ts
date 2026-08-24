import {StyleSheet} from 'react-native';
import {colors, typography} from '../../theme/tokens';

export const cryptoStyles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchLabel: {
    flex: 1,
    marginRight: 12,
    color: colors.text,
    fontSize: typography.body,
  },
  output: {
    fontSize: typography.body,
    color: colors.text,
  },
  flexBtn: {
    flex: 1,
    marginBottom: 0,
  },
  signActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
});
