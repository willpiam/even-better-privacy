import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Share from 'react-native-share';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  deleteIdentity,
  listIdentities,
  readIdentityRaw,
} from '../services/storage';
import {requestVerifyEmail} from '../services/contacts';
import {publishIdentity} from '../services/publish';
import {getServerUrl} from '../services/settings';
import {addDetail, listDetails} from '../services/details';
import {
  enforceAtLeastOneExportKey,
  resolveOpaqueDetailPath,
} from '../services/identity';
import {
  generateEmergencyCert,
  revokeDetail,
  revokeIdentity,
} from '../services/revocation';
import {exportPublicIdentity} from '../services/signVerify';
import type {StoredIdentityMeta} from '../types';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import Card from '../components/Card';
import CopyableOutput from '../components/CopyableOutput';
import {useSecretPrompt} from '../hooks/useSecretPrompt';
import {useIdentityUnlock} from '../hooks/useIdentityUnlock';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentityDetail'>;

export default function IdentityDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [identity, setIdentity] = useState<StoredIdentityMeta | null>(null);
  const [sessionUnlocked, setSessionUnlocked] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [publishServer, setPublishServer] = useState('');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<
    Array<{path: string; detail: string; proof: string}>
  >([]);
  const [detailPath, setDetailPath] = useState('');
  const [detailValue, setDetailValue] = useState('');
  const [detailPush, setDetailPush] = useState(false);
  const [detailOpaque, setDetailOpaque] = useState(false);
  const [revokePath, setRevokePath] = useState('');
  const [revokePathOpen, setRevokePathOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokePush, setRevokePush] = useState(false);
  const [includeSigningKey, setIncludeSigningKey] = useState(true);
  const [includeEncryptionKey, setIncludeEncryptionKey] = useState(true);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [exportOutput, setExportOutput] = useState('');
  const [emergencyOutput, setEmergencyOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Working…');

  useEffect(() => {
    navigation.setOptions({title: route.params.identityName});
  }, [navigation, route.params.identityName]);

  const loadProtected = useCallback(async () => {
    const [all, server] = await Promise.all([listIdentities(), getServerUrl()]);
    setServerUrl(server);
    const meta =
      all.find(item => item.name === route.params.identityName) ?? null;
    setIdentity(meta);
    if (!meta) {
      setSessionUnlocked(false);
      setDetails([]);
      return;
    }
    try {
      const unlocked = await ensureUnlocked(meta.name);
      if (!unlocked) {
        setSessionUnlocked(false);
        setDetails([]);
        return;
      }
      setSessionUnlocked(true);
      setDetails(await listDetails({identityName: unlocked}));
    } catch (error) {
      setSessionUnlocked(false);
      setDetails([]);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [route.params.identityName, ensureUnlocked]);

  useFocusEffect(
    useCallback(() => {
      void loadProtected();
    }, [loadProtected]),
  );

  const onPublish = async () => {
    setStatus('');
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      setBusy(true);
      setBusyMessage('Publishing…');
      const fingerprint = await publishIdentity({
        identityName: unlocked,
        server: publishServer.trim() || serverUrl,
      });
      setStatus(`Published: ${fingerprint}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onAddDetail = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      const path = resolveOpaqueDetailPath(detailPath, detailOpaque);
      await addDetail({
        identityName: unlocked,
        path,
        detail: detailValue,
        push: detailPush,
      });
      setStatus('Detail added');
      setDetailPath('');
      setDetailValue('');
      setDetailOpaque(false);
      setDetails(await listDetails({identityName: unlocked}));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onExportKeyToggle = (
    changed: 'signing' | 'encryption',
    next: boolean,
  ) => {
    const signing =
      changed === 'signing' ? next : includeSigningKey;
    const encryption =
      changed === 'encryption' ? next : includeEncryptionKey;
    const enforced = enforceAtLeastOneExportKey(signing, encryption, changed);
    if (
      enforced.includeSigningKey !== signing ||
      enforced.includeEncryptionKey !== encryption
    ) {
      setStatus('Export must include at least one public key');
    }
    setIncludeSigningKey(enforced.includeSigningKey);
    setIncludeEncryptionKey(enforced.includeEncryptionKey);
  };

  const onExportPublic = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      if (!includeSigningKey && !includeEncryptionKey) {
        throw new Error('Public export must include at least one public key');
      }
      const publicIdentity = await exportPublicIdentity(identity.name, undefined, {
        includeSigningKey,
        includeEncryptionKey,
        includeDetails,
      });
      setExportOutput(JSON.stringify(publicIdentity, null, 2));
      Clipboard.setString(JSON.stringify(publicIdentity));
      setStatus('Public identity exported');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onRevokeDetail = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      if (!revokePath.trim()) {
        throw new Error('Select a detail path to revoke');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      await revokeDetail({
        identityName: unlocked,
        path: revokePath,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Detail revoked');
      setRevokePath('');
      setRevokeReason('');
      setDetails(await listDetails({identityName: unlocked}));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const runRevokeIdentity = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      await revokeIdentity({
        identityName: unlocked,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Identity revoked');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onRevokeIdentity = () => {
    if (!identity) {
      return;
    }
    Alert.alert(
      'Revoke identity?',
      `This permanently revokes "${identity.name}". Continue?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm revoke',
              'This cannot be undone. Revoke this identity?',
              [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Revoke identity',
                  style: 'destructive',
                  onPress: () => void runRevokeIdentity(),
                },
              ],
            );
          },
        },
      ],
    );
  };

  const onExportFile = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const raw = await readIdentityRaw(identity.name);
      await Share.open({
        title: 'Export identity',
        message: raw,
        filename: `${identity.name}.identity.json`,
      });
      setStatus('Identity exported');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onDelete = () => {
    if (!identity) {
      return;
    }
    Alert.alert(
      'Delete identity',
      `Permanently delete "${identity.name}" from this device?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteIdentity(identity.name);
              setStatus('Identity deleted');
              navigation.navigate('IdentitiesHome');
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          },
        },
      ],
    );
  };

  const onVerifyEmail = async (path: string, detail: string) => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      let cleartext = detail;
      const verifyPath = path === 'opaque::email' ? 'opaque::email' : 'email';
      if (path === 'opaque::email') {
        const entered = await promptSecret({
          title: 'Verify opaque email',
          placeholder: 'Cleartext email matching the hash',
          submitLabel: 'Send',
          secureTextEntry: false,
        });
        if (entered === null) {
          return;
        }
        cleartext = entered.trim();
        if (!cleartext) {
          throw new Error('Email is required');
        }
      }
      await requestVerifyEmail({
        fingerprint: identity.fingerprint,
        detail: cleartext,
        path: verifyPath,
        server: serverUrl,
      });
      setStatus(`Verification email requested for ${cleartext}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onEmergencyCert = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) {
        return;
      }
      setSessionUnlocked(true);
      setBusy(true);
      setBusyMessage('Generating certificate…');
      const cert = await generateEmergencyCert({
        identityName: unlocked,
      });
      setEmergencyOutput(JSON.stringify(cert, null, 2));
      setStatus('Emergency certificate generated');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!identity) {
    return (
      <Screen>
        {unlockPrompt}
        {secretPrompt}
        <StatusBanner message="Identity not found." kind="error" />
      </Screen>
    );
  }

  const signingLabel =
    identity.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA';
  const detailPaths = details.map(item => item.path);

  return (
    <Screen scroll>
      {unlockPrompt}
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage} />
      <Card padded>
        <Text style={styles.name} testID="identity-name">
          {identity.name}
        </Text>
        <Text style={styles.meta}>
          {signingLabel} · {identity.encryptionKeyType}
        </Text>
        <Text style={styles.fp} testID="identity-fingerprint" selectable>
          {identity.fingerprint}
        </Text>
        <Text style={styles.meta}>Server: {serverUrl || '—'}</Text>
      </Card>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Unlock</SectionTitle>
      <Text style={styles.hint}>
        {sessionUnlocked
          ? 'Identity is unlocked for this session.'
          : 'Unlock once to load details and run protected actions.'}
      </Text>
      {sessionUnlocked ? null : (
        <AppButton
          title="Unlock identity"
          testID="identity-unlock"
          onPress={() => void loadProtected()}
        />
      )}

      <SectionTitle>Publish</SectionTitle>
      <TextField
        label="Server override (optional)"
        testID="identity-publish-server"
        value={publishServer}
        onChangeText={setPublishServer}
        placeholder={serverUrl || 'Uses Settings URL when empty'}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <AppButton
        title="Publish to server"
        testID="identity-publish"
        onPress={onPublish}
        disabled={busy}
      />

      <SectionTitle>Identity details</SectionTitle>
      {details.length === 0 ? (
        <Text style={styles.hint}>
          {sessionUnlocked
            ? 'No details yet. Add one below.'
            : 'Unlock the identity to load details.'}
        </Text>
      ) : (
        details.map(item => (
          <Card key={item.path} padded style={styles.detailCard}>
            <Text style={styles.detail}>
              {item.path}: {item.detail}
            </Text>
            {item.path === 'email' || item.path === 'opaque::email' ? (
              <AppButton
                title="Verify email"
                variant="secondary"
                onPress={() => onVerifyEmail(item.path, item.detail)}
              />
            ) : null}
          </Card>
        ))
      )}

      <Text style={styles.fieldLabel}>Add detail</Text>
      <TextField
        label="Detail path"
        testID="identity-detail-path"
        value={detailPath}
        onChangeText={setDetailPath}
        placeholder="e.g. email"
      />
      <TextField
        label="Detail value"
        testID="identity-detail-value"
        value={detailValue}
        onChangeText={setDetailValue}
      />
      <Pressable
        testID="identity-detail-opaque"
        accessibilityRole="switch"
        accessibilityState={{checked: detailOpaque}}
        accessibilityLabel="Opaque (hash value)"
        onPress={() => setDetailOpaque(value => !value)}
        style={styles.switchRow}>
        <Text style={styles.switchLabel}>Opaque (hash value)</Text>
        <Switch
          value={detailOpaque}
          onValueChange={setDetailOpaque}
          pointerEvents="none"
        />
      </Pressable>
      <Pressable
        testID="identity-detail-push"
        accessibilityRole="switch"
        accessibilityState={{checked: detailPush}}
        accessibilityLabel="Push detail to server"
        onPress={() => setDetailPush(value => !value)}
        style={styles.switchRow}>
        <Text style={styles.switchLabel}>Push to server</Text>
        <Switch
          value={detailPush}
          onValueChange={setDetailPush}
          pointerEvents="none"
        />
      </Pressable>
      <AppButton
        title="Add detail"
        testID="identity-add-detail"
        variant="secondary"
        onPress={onAddDetail}
      />

      <SectionTitle>Device file</SectionTitle>
      <AppButton
        title="Export identity file"
        variant="secondary"
        onPress={onExportFile}
      />
      <AppButton
        title="Emergency certificate"
        testID="identity-emergency-cert"
        variant="secondary"
        onPress={onEmergencyCert}
      />
      <SectionTitle>Public export</SectionTitle>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Include signing key</Text>
        <Switch
          testID="identity-export-signing"
          value={includeSigningKey}
          onValueChange={next => onExportKeyToggle('signing', next)}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Include encryption key</Text>
        <Switch
          testID="identity-export-encryption"
          value={includeEncryptionKey}
          onValueChange={next => onExportKeyToggle('encryption', next)}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Include details</Text>
        <Switch
          testID="identity-export-details"
          value={includeDetails}
          onValueChange={setIncludeDetails}
        />
      </View>
      <AppButton
        title="Export public JSON"
        testID="identity-export-public"
        variant="secondary"
        onPress={onExportPublic}
      />
      {exportOutput ? (
        <CopyableOutput
          testID="identity-export-public-output"
          value={exportOutput}
        />
      ) : null}
      {emergencyOutput ? (
        <TextField
          label="Emergency certificate"
          testID="identity-emergency-output"
          value={emergencyOutput}
          editable={false}
          multiline
        />
      ) : null}

      <SectionTitle>Revocation</SectionTitle>
      <Text style={styles.fieldLabel}>Detail path to revoke</Text>
      <Pressable
        testID="identity-revoke-path-picker"
        accessibilityRole="button"
        accessibilityState={{expanded: revokePathOpen}}
        onPress={() => setRevokePathOpen(open => !open)}
        style={styles.pickerTrigger}>
        <Text
          style={revokePath ? styles.pickerValue : styles.pickerPlaceholder}>
          {revokePath || 'Select a detail path…'}
        </Text>
        <Text style={styles.pickerChevron}>{revokePathOpen ? '▲' : '▼'}</Text>
      </Pressable>
      {revokePathOpen ? (
        <View style={styles.pickerList}>
          {detailPaths.length === 0 ? (
            <Text style={styles.hint}>
              No loaded details. Unlock the identity first.
            </Text>
          ) : (
            detailPaths.map((path, index) => (
              <Pressable
                key={path}
                testID={`identity-revoke-path-${path}`}
                onPress={() => {
                  setRevokePath(path);
                  setRevokePathOpen(false);
                }}
                style={[
                  styles.pickerItem,
                  index < detailPaths.length - 1 && styles.pickerItemDivider,
                  path === revokePath && styles.pickerItemSelected,
                ]}>
                <Text style={styles.pickerItemText}>{path}</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      <TextField
        label="Reason (optional)"
        value={revokeReason}
        onChangeText={setRevokeReason}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Push to server</Text>
        <Switch value={revokePush} onValueChange={setRevokePush} />
      </View>
      <AppButton
        title="Revoke detail"
        variant="secondary"
        onPress={onRevokeDetail}
      />
      <AppButton
        title="Revoke identity"
        variant="danger"
        onPress={onRevokeIdentity}
      />
      <AppButton
        title="Delete from device"
        testID="identity-delete"
        variant="danger"
        onPress={onDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: {fontWeight: '700', fontSize: 18, color: colors.text, marginBottom: 6},
  meta: {fontSize: typography.caption, color: colors.muted, marginTop: 4},
  fp: {
    marginTop: 8,
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  hint: {fontSize: 13, color: colors.muted, lineHeight: 18},
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailCard: {gap: 8},
  detail: {color: colors.text, marginBottom: 4},
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchLabel: {flex: 1, marginRight: 12, color: colors.text},
  pickerTrigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerValue: {flex: 1, color: colors.text, fontSize: 15},
  pickerPlaceholder: {flex: 1, color: '#999', fontSize: 15},
  pickerChevron: {color: colors.muted, fontSize: 12, marginLeft: 8},
  pickerList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pickerItem: {paddingHorizontal: 14, paddingVertical: 12},
  pickerItemDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerItemSelected: {backgroundColor: colors.accentSoft},
  pickerItemText: {color: colors.text, fontSize: 15},
});
