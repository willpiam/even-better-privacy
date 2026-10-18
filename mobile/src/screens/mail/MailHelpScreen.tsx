import React from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailHelp'>;

export default function MailHelpScreen(_props: Props): JSX.Element {
  return (
    <Screen scroll>
      <SectionTitle>How to Connect Your Email</SectionTitle>
      <Text testID="mail-help-body" style={styles.body}>
        <Text style={styles.bold}>Gmail: </Text>
        turn on 2FA in your Google account, then create an App Password and use
        that in EBP as your IMAP/SMTP password. Typical settings:{' '}
        <Text style={styles.code}>imap.gmail.com:993</Text> (TLS on) and{' '}
        <Text style={styles.code}>smtp.gmail.com:465</Text> (TLS on).
        {'\n\n'}
        <Text style={styles.bold}>Proton Mail: </Text>
        use Proton Mail Bridge for desktop IMAP/SMTP access. Enter the Bridge
        host/ports and the Bridge-generated username/password in EBP.
        {'\n\n'}
        <Text style={styles.bold}>All Others: </Text>
        this works with most providers the same way. Use your provider's IMAP +
        SMTP settings, enable secure ports/TLS, and use an app-specific password
        if your provider requires it.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: typography.body,
    color: colors.muted,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
    color: colors.text,
  },
  code: {
    fontFamily: 'monospace',
    color: colors.text,
  },
});
