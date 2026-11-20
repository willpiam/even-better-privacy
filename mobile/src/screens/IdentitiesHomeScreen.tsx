import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
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
import type {StoredIdentityMeta} from '../types';
import {getMailTestMode, getServerUrl} from '../services/settings';
import {reconcilePendingSignups} from '../services/mail/reconcileSignup';
import {PROTOCOL_VERSION} from '../../../core/version';
import Screen from '../components/Screen';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import Card from '../components/Card';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';
import {colors, layout, radius, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';
import {shortFingerprint} from '../ebpCore';
import PlaceHeader from '../components/PlaceHeader';
import AppIcon from '../components/AppIcon';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentitiesHome'>;

export default function IdentitiesHomeScreen({navigation}: Props): JSX.Element {
  const {accent, pale} = usePlaceTheme();
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [currentIdentity, setCurrentIdentityValue] = useState<string | null>(
    null,
  );
  const [serverUrl, setServerUrl] = useState<string>('');
  const [status, setStatus] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [signupAction, setSignupAction] = useState<'resume' | 'restore' | 'manage' | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [list, current, server] = await Promise.all([
      listIdentities(),
      getCurrentIdentity(),
      getServerUrl(),
    ]);
    if (generation !== refreshGeneration.current) return;
    setIdentities(list);
    setCurrentIdentityValue(current);
    setServerUrl(server);
    const testingEnabled = await getMailTestMode();
    const saved = await reconcilePendingSignups(server, testingEnabled, list);
    if (generation !== refreshGeneration.current) return;
    setSignupAction(saved.some(item => item.action === 'resume') ? 'resume'
      : saved.some(item => item.action === 'restore') ? 'restore' : saved.length ? 'manage' : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const reload = () => {refresh().catch(() => {});};
      reload();
      const subscription = AppState.addEventListener('change', value => {
        if (value === 'active') reload();
      });
      return () => {
        ++refreshGeneration.current;
        subscription.remove();
        setMenuOpen(false);
      };
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
          style={({pressed}) => [
            styles.headerAction,
            (pressed || menuOpen) && {backgroundColor: pale},
          ]}
          onPress={() => setMenuOpen(open => !open)}>
          <AppIcon name="plus" color={accent} />
        </Pressable>
      ),
    });
  }, [navigation, menuOpen, accent, pale]);

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
    <Screen contentStyle={styles.content}>
      <FlatList
        data={identities}
        keyExtractor={item => item.name}
        testID="identities-list"
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}
        ListHeaderComponent={
          <View style={styles.intro}>
            <PlaceHeader
              title="Your identities"
              subtitle="Manage the keys you use to sign and decrypt."
            />
            <StatusBanner message={status} kind={statusKind(status)} />
            {signupAction ? (
              <AppButton
                title={
                  signupAction === 'resume'
                    ? 'Resume email setup'
                    : signupAction === 'restore'
                    ? 'Restore mailbox access'
                    : 'Manage unfinished email purchases'
                }
                testID="identities-resume-onboarding"
                variant={signupAction === 'manage' ? 'secondary' : undefined}
                onPress={() => navigation.navigate('OnboardingWizard')}
              />
            ) : null}
            <SectionTitle>{`Local identities · ${identities.length}`}</SectionTitle>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="identities-empty">
            <Text style={styles.emptyTitle}>No identities yet</Text>
            <Text style={styles.emptySub}>
              Create a quantum-secure email address and keys, or use + to create
              or import an identity.
            </Text>
            <AppButton
              title="Get started with EBP email"
              testID="identities-onboarding-empty"
              onPress={() => navigation.navigate('OnboardingWizard')}
            />
          </View>
        }
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
        ListFooterComponent={
          <Text style={styles.meta}>
            Server: <Text style={styles.metaStrong}>{serverUrl || '—'}</Text>
            {'\n'}Protocol:{' '}
            <Text style={styles.metaStrong}>{PROTOCOL_VERSION}</Text>
          </Text>
        }
      />
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
            <ListRow
              testID="identities-create"
              title="Create identity"
              showChevron={false}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('HdCreate');
              }}
            />
            <ListRow
              testID="identities-import"
              title="Import identity file"
              showChevron={false}
              showDivider={false}
              onPress={() => {
                setMenuOpen(false);
                void onImport();
              }}
            />
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {padding: 0, paddingBottom: 0},
  listContent: {paddingBottom: spacing.xl},
  intro: {
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerAction: {
    minWidth: layout.controlHeight,
    minHeight: layout.controlHeight,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    top: 0,
    end: layout.gutter,
    width: 240,
    maxWidth: '88%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  meta: {
    fontSize: typography.caption,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 12,
    paddingHorizontal: layout.gutter,
  },
  metaStrong: {
    color: colors.text,
    fontWeight: '600',
  },
  empty: {paddingHorizontal: layout.gutter, gap: spacing.md},
  emptyTitle: {
    fontSize: typography.title,
    fontWeight: '600',
    color: colors.text,
  },
  emptySub: {
    fontSize: typography.body,
    color: colors.muted,
  },
});
