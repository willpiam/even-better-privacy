import React, {useCallback, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  getCurrentIdentity,
  listIdentities,
  setCurrentIdentity,
} from '../services/storage';
import type {StoredIdentityMeta} from '../types';
import {getServerUrl} from '../services/settings';
import {PROTOCOL_VERSION} from '../../../core/version';
import Screen from '../components/Screen';
import Chip from '../components/Chip';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import Card from '../components/Card';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentitiesHome'>;

function truncateFp(fp: string): string {
  if (fp.length <= 12) {
    return fp;
  }
  return `${fp.slice(0, 4)}…${fp.slice(-4)}`;
}

export default function IdentitiesHomeScreen({navigation}: Props): JSX.Element {
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [currentIdentity, setCurrentIdentityValue] = useState<string | null>(
    null,
  );
  const [serverUrl, setServerUrl] = useState<string>('');

  const refresh = useCallback(async () => {
    const [list, current, server] = await Promise.all([
      listIdentities(),
      getCurrentIdentity(),
      getServerUrl(),
    ]);
    setIdentities(list);
    setCurrentIdentityValue(current);
    setServerUrl(server);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text
          style={styles.headerAction}
          onPress={() => navigation.navigate('CreateIdentity')}>
          +
        </Text>
      ),
    });
  }, [navigation]);

  const onSelectIdentity = async (name: string) => {
    await setCurrentIdentity(name);
    setCurrentIdentityValue(name);
    navigation.navigate('IdentityDetail', {identityName: name});
  };

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {currentIdentity ? (
        <Chip label={`Current: ${currentIdentity}`} />
      ) : null}
      <Text style={styles.meta}>
        Server: <Text style={styles.metaStrong}>{serverUrl || '—'}</Text>
        {'\n'}
        Protocol: <Text style={styles.metaStrong}>{PROTOCOL_VERSION}</Text>
      </Text>
      <View style={styles.row}>
        <AppButton
          title="Create"
          onPress={() => navigation.navigate('CreateIdentity')}
          style={styles.flexBtn}
        />
        <AppButton
          title="EBP-HD"
          variant="secondary"
          onPress={() => navigation.navigate('HdCreate')}
          style={styles.flexBtn}
        />
      </View>
      <SectionTitle>Local identities</SectionTitle>
      {identities.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>◎</Text>
          <Text style={styles.emptyTitle}>No identities yet</Text>
          <Text style={styles.emptySub}>
            Create a local identity or restore one from an EBP-HD mnemonic.
          </Text>
          <AppButton
            title="Create identity"
            onPress={() => navigation.navigate('CreateIdentity')}
            style={styles.fullBtn}
          />
          <AppButton
            title="Restore with EBP-HD"
            variant="secondary"
            onPress={() => navigation.navigate('HdCreate')}
            style={styles.fullBtn}
          />
        </View>
      ) : (
        <Card>
          <FlatList
            data={identities}
            keyExtractor={item => item.name}
            scrollEnabled={false}
            renderItem={({item}) => (
              <ListRow
                avatarText={item.name}
                title={item.name}
                subtitle={`${
                  item.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA'
                } · ${truncateFp(item.fingerprint)}`}
                badge={item.name === currentIdentity ? 'Current' : undefined}
                onPress={() => onSelectIdentity(item.name)}
              />
            )}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1},
  headerAction: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: '500',
    paddingHorizontal: 8,
  },
  meta: {
    fontSize: typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  metaStrong: {
    color: colors.text,
    fontWeight: '600',
  },
  row: {flexDirection: 'row', gap: 8},
  flexBtn: {flex: 1},
  fullBtn: {alignSelf: 'stretch', width: '100%'},
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyIcon: {fontSize: 40, opacity: 0.35, marginBottom: 4},
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  emptySub: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 260,
    lineHeight: 18,
  },
});
