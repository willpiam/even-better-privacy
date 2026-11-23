import React, {useCallback, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {CryptoStackParamList} from '../navigation/AppNavigator';
import {getCurrentIdentity} from '../services/storage';
import Screen from '../components/Screen';
import Chip from '../components/Chip';
import ListSection from '../components/ListSection';
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
        subtitle="Sign, verify, encrypt, and decrypt messages and files."
      />
      {currentIdentity ? (
        <Chip label={`Current: ${currentIdentity}`} />
      ) : (
        <Text style={styles.hint}>
          No current identity selected. Choose one under Identities.
        </Text>
      )}

      <SectionTitle>Sign / Verify</SectionTitle>
      <ListSection>
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
          subtitle="Check a signed message or detached signature"
          testID="crypto-verify-message"
          onPress={() => navigation.navigate('VerifyMessage')}
        />
        <ListRow
          title="Sign file"
          icon="fileSign"
          subtitle="Create a separate signature for a file"
          onPress={() => navigation.navigate('SignFile')}
        />
        <ListRow
          title="Verify file"
          icon="certificate"
          subtitle="Check an original file against its signature"
          onPress={() => navigation.navigate('VerifyFile')}
        />
        <ListRow
          title="Identity fingerprint"
          icon="fingerprint"
          subtitle="Calculate a fingerprint from a public identity export"
          onPress={() => navigation.navigate('FingerprintTool')}
          showDivider={false}
        />
      </ListSection>

      <SectionTitle>Encrypt / Decrypt</SectionTitle>
      <ListSection>
        <ListRow
          title="Encrypt message"
          icon="lock"
          subtitle="Encrypt text for a contact, optionally signed"
          onPress={() => navigation.navigate('EncryptMessage')}
        />
        <ListRow
          title="Decrypt message"
          icon="unlock"
          subtitle="Open a message encrypted for your identity"
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
          subtitle="Recover a file from its encrypted payload"
          onPress={() => navigation.navigate('DecryptFile')}
          showDivider={false}
        />
      </ListSection>
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
