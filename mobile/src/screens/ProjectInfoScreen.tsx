import React from 'react';
import {Linking, StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import Screen from '../components/Screen';
import SectionTitle from '../components/SectionTitle';
import Card from '../components/Card';
import AppButton from '../components/AppButton';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'ProjectInfo'>;

export default function ProjectInfoScreen(_props: Props): JSX.Element {
  return (
    <Screen scroll>
      <Card padded>
        <Text style={styles.p}>
          EBP (Even Better Privacy) is a post-quantum cryptographic identity and
          messaging system using Dilithium/SPHINCS+ for signatures and Kyber for
          encryption.
        </Text>
      </Card>

      <SectionTitle>How It Works</SectionTitle>
      <Card padded>
        <Text style={styles.p}>1. Generate identity (signing + encryption keys)</Text>
        <Text style={styles.p}>2. Share public identity and import contacts</Text>
        <Text style={styles.p}>3. Sign/verify messages and files</Text>
        <Text style={styles.p}>4. Encrypt/decrypt messages and files</Text>
        <Text style={styles.p}>5. Publish public identity to key server</Text>
      </Card>

      <SectionTitle>Security Note</SectionTitle>
      <Card padded>
        <Text style={styles.p}>
          Keep private keys and revocation certificates secure. Anyone with your
          private keys (or emergency revocation cert) can act on your identity.
        </Text>
      </Card>

      <SectionTitle>Links</SectionTitle>
      <AppButton
        title="GitHub repository"
        variant="secondary"
        onPress={() =>
          void Linking.openURL(
            'https://github.com/willpiam/even-better-privacy',
          )
        }
      />
      <AppButton
        title="Project website"
        variant="secondary"
        onPress={() => void Linking.openURL('https://williamdoyle.ca/ebp')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  p: {
    marginBottom: 6,
    color: colors.text,
    lineHeight: 20,
    fontSize: typography.body,
  },
});
