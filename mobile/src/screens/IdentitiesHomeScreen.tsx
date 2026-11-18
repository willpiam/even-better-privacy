import React, {useCallback, useEffect, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
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
import type {StoredIdentityMeta} from '../types';
import {getMailTestMode, getServerUrl} from '../services/settings';
import {pendingSignups} from '../services/mail/pendingSignup';
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
import PlaceHeader from '../components/PlaceHeader';
import AppIcon from '../components/AppIcon';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentitiesHome'>;

export default function IdentitiesHomeScreen({navigation}: Props): JSX.Element {
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [currentIdentity, setCurrentIdentityValue] = useState<string | null>(
    null,
  );
  const [serverUrl, setServerUrl] = useState<string>('');
  const [status, setStatus] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasPendingSignup, setHasPendingSignup] = useState(false);

  const refresh = useCallback(async () => {
    const [list, current, server] = await Promise.all([
      listIdentities(),
      getCurrentIdentity(),
      getServerUrl(),
    ]);
    setIdentities(list);
    setCurrentIdentityValue(current);
    setServerUrl(server);
    const testingEnabled = await getMailTestMode();
    const saved = [
      ...await pendingSignups(server, undefined, false),
      ...(testingEnabled ? await pendingSignups(server, undefined, true) : []),
    ];
    setHasPendingSignup(saved.length > 0);
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
          <AppIcon name="plus" />
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
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}>
        <PlaceHeader
          title="Your identities"
          subtitle="A little space for every part of you."
        />
        {currentIdentity ? (
          <Chip label={`Current: ${currentIdentity}`} />
        ) : null}
        <StatusBanner message={status} kind={statusKind(status)} />
        {hasPendingSignup ? (
          <AppButton
            title="Resume email setup"
            testID="identities-resume-onboarding"
            onPress={() => navigation.navigate('OnboardingWizard')}
          />
        ) : null}
        <SectionTitle>{`Local identities · ${identities.length}`}</SectionTitle>
        {identities.length === 0 ? (
          <View style={styles.empty} testID="identities-empty">
            <View style={styles.emptyMark}>
              <AppIcon name="key" size={28} />
            </View>
            <Text style={styles.emptyTitle}>No identities yet</Text>
            <Text style={styles.emptySub}>
              Make yourself at home. Create a quantum-secure email address and
              keys, or use + to create or import an identity.
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
        <Text style={styles.meta}>
          Server: <Text style={styles.metaStrong}>{serverUrl || '—'}</Text>
          {'\n'}Protocol:{' '}
          <Text style={styles.metaStrong}>{PROTOCOL_VERSION}</Text>
        </Text>
      </ScrollView>
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
  content: {flex: 1, paddingBottom: 16},
  body: {flexGrow: 1, gap: 14, paddingBottom: 16},
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 12,
    paddingHorizontal: 4,
  },
  metaStrong: {
    color: colors.text,
    fontWeight: '600',
  },
  fullBtn: {alignSelf: 'stretch', width: '100%'},
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyMark: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
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
