import React, {useCallback, useEffect, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  pick,
  keepLocalCopy,
  errorCodes,
  isErrorWithCode,
} from '@react-native-documents/picker';
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
import {shortFingerprint} from '../ebpCore';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentitiesHome'>;

export default function IdentitiesHomeScreen({navigation}: Props): JSX.Element {
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [currentIdentity, setCurrentIdentityValue] = useState<string | null>(
    null,
  );
  const [serverUrl, setServerUrl] = useState<string>('');
  const [status, setStatus] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

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
      return () => setMenuOpen(false);
    }, [refresh]),
  );

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setMenuOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [menuOpen]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          testID="identities-add"
          accessibilityRole="button"
          accessibilityLabel="Add identity"
          accessibilityState={{expanded: menuOpen}}
          style={styles.headerAction}
          onPress={() => setMenuOpen(open => !open)}>
          <Text style={styles.headerActionText}>+</Text>
        </Pressable>
      ),
    });
  }, [navigation, menuOpen]);

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
      if (
        isErrorWithCode(error) &&
        error.code === errorCodes.OPERATION_CANCELED
      ) {
        return;
      }
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      <View
        style={styles.body}
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}>
        {currentIdentity ? (
          <Chip label={`Current: ${currentIdentity}`} />
        ) : null}
        <Text style={styles.meta}>
          Server: <Text style={styles.metaStrong}>{serverUrl || '—'}</Text>
          {'\n'}
          Protocol: <Text style={styles.metaStrong}>{PROTOCOL_VERSION}</Text>
        </Text>
        <StatusBanner message={status} kind={statusKind(status)} />
        <SectionTitle>Local identities</SectionTitle>
        {identities.length === 0 ? (
          <View style={styles.empty} testID="identities-empty">
            <Text style={styles.emptyIcon}>◎</Text>
            <Text style={styles.emptyTitle}>No identities yet</Text>
            <Text style={styles.emptySub}>
              Get a quantum-secure email address and keys in one step, or use
              the + button above to create or import an identity.
            </Text>
            <AppButton
              title="Get started with EBP email"
              testID="identities-onboarding-empty"
              onPress={() => navigation.navigate('OnboardingWizard')}
              style={styles.fullBtn}
            />
          </View>
        ) : (
          <Card>
            <FlatList
              data={identities}
              keyExtractor={item => item.name}
              scrollEnabled={false}
              testID="identities-list"
              renderItem={({item, index}) => (
                <ListRow
                  testID={`identity-row-${item.name}`}
                  avatarText={item.name}
                  title={item.name}
                  subtitle={`${
                    item.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA'
                  } · ${shortFingerprint(item.fingerprint)}`}
                  badge={item.name === currentIdentity ? 'Current' : undefined}
                  onPress={() => onSelectIdentity(item.name)}
                  showDivider={index < identities.length - 1}
                />
              )}
            />
          </Card>
        )}
      </View>
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            testID="identities-menu-dismiss"
            accessibilityRole="button"
            accessibilityLabel="Dismiss identity menu"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <Card style={styles.menu}>
            <Pressable
              testID="identities-create"
              accessibilityRole="button"
              accessibilityLabel="Create identity"
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('HdCreate');
              }}>
              <Text style={styles.menuText}>Create identity</Text>
            </Pressable>
            <Pressable
              testID="identities-import"
              accessibilityRole="button"
              accessibilityLabel="Import identity file"
              style={[styles.menuItem, styles.menuDivider]}
              onPress={() => {
                setMenuOpen(false);
                void onImport();
              }}>
              <Text style={styles.menuText}>Import identity file</Text>
            </Pressable>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1},
  body: {flex: 1, gap: 10},
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: '500',
  },
  menu: {
    position: 'absolute',
    top: 0,
    right: 12,
    width: 240,
    maxWidth: '100%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  menuItem: {minHeight: 48, justifyContent: 'center', padding: 14},
  menuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuText: {fontSize: typography.body, color: colors.accent},
  meta: {
    fontSize: typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  metaStrong: {
    color: colors.text,
    fontWeight: '600',
  },
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
