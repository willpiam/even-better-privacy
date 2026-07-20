import React, {useCallback, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {CryptoStackParamList} from '../navigation/AppNavigator';
import {getCurrentIdentity} from '../services/storage';
import Screen from '../components/Screen';
import Chip from '../components/Chip';
import Card from '../components/Card';
import ListRow from '../components/ListRow';
import SectionTitle from '../components/SectionTitle';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<CryptoStackParamList, 'CryptoHub'>;

export default function CryptoHubScreen({navigation}: Props): JSX.Element {
  const [currentIdentity, setCurrentIdentity] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getCurrentIdentity().then(setCurrentIdentity);
    }, []),
  );

  return (
    <Screen scroll>
      {currentIdentity ? (
        <Chip label={`Current: ${currentIdentity}`} />
      ) : (
        <Text style={styles.hint}>
          No current identity selected. Choose one under Identities.
        </Text>
      )}

      <SectionTitle>Sign / Verify</SectionTitle>
      <Card>
        <ListRow
          title="Sign message"
          subtitle="Sign text with your identity"
          onPress={() => navigation.navigate('SignMessage')}
        />
        <ListRow
          title="Verify message"
          subtitle="Check a signed payload"
          onPress={() => navigation.navigate('VerifyMessage')}
        />
        <ListRow
          title="Sign file"
          subtitle="Sign a file from storage"
          onPress={() => navigation.navigate('SignFile')}
        />
        <ListRow
          title="Verify file"
          subtitle="Verify a file signature"
          onPress={() => navigation.navigate('VerifyFile')}
        />
        <ListRow
          title="Fingerprint from public JSON"
          subtitle="Compute fingerprint from a public identity"
          onPress={() => navigation.navigate('FingerprintTool')}
        />
      </Card>

      <SectionTitle>Encrypt / Decrypt</SectionTitle>
      <Card>
        <ListRow
          title="Encrypt message"
          subtitle="Encrypt text for a contact"
          onPress={() => navigation.navigate('EncryptMessage')}
        />
        <ListRow
          title="Decrypt message"
          subtitle="Decrypt a message payload"
          onPress={() => navigation.navigate('DecryptMessage')}
        />
        <ListRow
          title="Encrypt file"
          subtitle="Encrypt a file for a contact"
          onPress={() => navigation.navigate('EncryptFile')}
        />
        <ListRow
          title="Decrypt file"
          subtitle="Decrypt a file payload"
          onPress={() => navigation.navigate('DecryptFile')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
});
