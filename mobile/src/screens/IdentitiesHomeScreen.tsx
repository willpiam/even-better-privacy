import React, {useCallback, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {pick, keepLocalCopy} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  getCurrentIdentity,
  importIdentity,
  listIdentities,
  setCurrentIdentity,
} from '../services/storage';
import {appendActivityLog} from '../services/activityLog';
import type {StoredIdentityMeta} from '../types';
import {getServerUrl} from '../services/settings';
import {PROTOCOL_VERSION} from '../../../core/version';
import Screen from '../components/Screen';
import Chip from '../components/Chip';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import Card from '../components/Card';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';
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
  const [status, setStatus] = useState('');

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
          onPress={() => navigation.navigate('HdCreate')}>
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

  const onImport = async () => {
    setStatus('');
    try {
      const [file] = await pick({mode: 'import'});
      const [copy] = await keepLocalCopy({
        destination: 'cachesDirectory',
        files: [{uri: file.uri, fileName: file.name ?? 'identity.json'}],
      });
      if (copy.status !== 'success') {
        throw new Error('Failed to copy identity file');
      }
      const path = copy.localUri.startsWith('file://')
        ? copy.localUri.replace('file://', '')
        : copy.localUri;
      const raw = await RNFS.readFile(path, 'utf8');
      const meta = await importIdentity({storageJson: raw, overwrite: false});
      await appendActivityLog(`Imported identity ${meta.name}`, 'success');
      setStatus(`Imported ${meta.name}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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
      <StatusBanner message={status} kind={statusKind(status)} />
      <View style={styles.row}>
        <AppButton
          title="Create"
          onPress={() => navigation.navigate('HdCreate')}
          style={styles.flexBtn}
        />
        <AppButton
          title="Import"
          variant="secondary"
          onPress={() => void onImport()}
          style={styles.flexBtn}
        />
      </View>
      <SectionTitle>Local identities</SectionTitle>
      {identities.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>◎</Text>
          <Text style={styles.emptyTitle}>No identities yet</Text>
          <Text style={styles.emptySub}>
            Create an identity from a mnemonic, or import an existing identity
            file.
          </Text>
          <AppButton
            title="Create identity"
            onPress={() => navigation.navigate('HdCreate')}
            style={styles.fullBtn}
          />
          <AppButton
            title="Import identity file"
            variant="secondary"
            onPress={() => void onImport()}
            style={styles.fullBtn}
          />
        </View>
      ) : (
        <Card>
          <FlatList
            data={identities}
            keyExtractor={item => item.name}
            scrollEnabled={false}
            renderItem={({item, index}) => (
              <ListRow
                avatarText={item.name}
                title={item.name}
                subtitle={`${
                  item.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA'
                } · ${truncateFp(item.fingerprint)}`}
                badge={item.name === currentIdentity ? 'Current' : undefined}
                onPress={() => onSelectIdentity(item.name)}
                showDivider={index < identities.length - 1}
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
