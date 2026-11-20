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
import PlaceHeader from '../components/PlaceHeader';

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
      <PlaceHeader
        title="Privacy tools"
        subtitle="A little peace of mind. Sign, verify, and keep your words private."
      />
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
          icon="sign"
          subtitle="Sign text with your identity"
          testID="crypto-sign-message"
          onPress={() => navigation.navigate('SignMessage')}
        />
        <ListRow
          title="Verify message"
          icon="verify"
          subtitle="Check a signed payload"
          testID="crypto-verify-message"
          onPress={() => navigation.navigate('VerifyMessage')}
        />
        <ListRow
          title="Sign file"
          icon="fileSign"
          subtitle="Sign a file from storage"
          onPress={() => navigation.navigate('SignFile')}
        />
        <ListRow
          title="Verify file"
          icon="certificate"
          subtitle="Verify a file signature"
          onPress={() => navigation.navigate('VerifyFile')}
        />
        <ListRow
          title="Fingerprint from public JSON"
          icon="fingerprint"
          subtitle="Compute fingerprint from a public identity"
          onPress={() => navigation.navigate('FingerprintTool')}
          showDivider={false}
        />
      </Card>

      <SectionTitle>Encrypt / Decrypt</SectionTitle>
      <Card>
        <ListRow
          title="Encrypt message"
          icon="lock"
          subtitle="Encrypt text for a contact, optionally signed"
          onPress={() => navigation.navigate('EncryptMessage')}
        />
        <ListRow
          title="Decrypt message"
          icon="unlock"
          subtitle="Decrypt a message payload"
          onPress={() => navigation.navigate('DecryptMessage')}
        />
        <ListRow
          title="Encrypt file"
          icon="fileLock"
          subtitle="Encrypt a file for a contact"
          onPress={() => navigation.navigate('EncryptFile')}
        />
        <ListRow
          title="Decrypt file"
          icon="fileUnlock"
          subtitle="Decrypt a file payload"
          onPress={() => navigation.navigate('DecryptFile')}
          showDivider={false}
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
