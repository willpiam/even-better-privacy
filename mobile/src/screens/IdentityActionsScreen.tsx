import React, {useEffect, useState} from 'react';
import {Alert, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import Share from 'react-native-share';
import Clipboard from '@react-native-clipboard/clipboard';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {deleteIdentity, readIdentityRaw} from '../services/storage';
import {requestVerifyEmail} from '../services/contacts';
import {publishIdentity} from '../services/publish';
import {addDetail, publishDetail} from '../services/details';
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
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import Card from '../components/Card';
import CopyableOutput from '../components/CopyableOutput';
import {useSecretPrompt} from '../hooks/useSecretPrompt';
import {useIdentityProfile} from '../hooks/useIdentityProfile';
import {
  fetchIdentityPublication,
  isEmailVerified,
  isDetailPublished,
} from '../services/identityPublication';
import IdentityPublicationStatus from '../components/IdentityPublicationStatus';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<
  IdentitiesStackParamList,
  'IdentityPublish' | 'IdentityDetails' | 'IdentityExport' | 'IdentitySecurity'
>;
const titles = {
  IdentityPublish: 'Publish identity',
  IdentityDetails: 'Identity details',
  IdentityExport: 'Export and backup',
  IdentitySecurity: 'Revocation and removal',
};

export default function IdentityActionsScreen({
  route,
  navigation,
}: Props): React.JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const {
    identity,
    loading,
    sessionUnlocked,
    serverUrl,
    details,
    localDetails,
    locallyRevoked,
    publication,
    refresh,
    unlock,
    ensureUnlocked,
    unlockPrompt,
    error: profileError,
  } = useIdentityProfile(route.params.identityName);
  const [publishServer, setPublishServer] = useState('');
  const [status, setStatus] = useState('');
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
    navigation.setOptions({title: titles[route.name]});
  }, [navigation, route.name]);

  const onUnlock = async () => {
    try {
      await unlock();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

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
      setBusy(true);
      setBusyMessage('Publishing…');
      const target = publishServer.trim() || serverUrl;
      const existing = await fetchIdentityPublication(
        identity.fingerprint,
        target,
      );
      if (existing.state === 'published' || existing.state === 'revoked') {
        setStatus(
          existing.state === 'revoked'
            ? 'This identity is revoked on that server.'
            : 'Already published on that server.',
        );
        await refresh();
        return;
      }
      const fingerprint = await publishIdentity({
        identityName: unlocked,
        server: publishServer.trim() || serverUrl,
      });
      setStatus(`Published: ${fingerprint}`);
      await refresh();
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
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onPublishDetail = async (path: string) => {
    try {
      const unlocked = await ensureUnlocked(route.params.identityName);
      if (!unlocked) return;
      await publishDetail({identityName: unlocked, path, server: serverUrl});
      setStatus('Detail published');
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const onExportKeyToggle = (
    changed: 'signing' | 'encryption',
    next: boolean,
  ) => {
    const signing = changed === 'signing' ? next : includeSigningKey;
    const encryption = changed === 'encryption' ? next : includeEncryptionKey;
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
      if (!includeSigningKey && !includeEncryptionKey) {
        throw new Error('Public export must include at least one public key');
      }
      const publicIdentity = await exportPublicIdentity(
        identity.name,
        undefined,
        {
          includeSigningKey,
          includeEncryptionKey,
          includeDetails,
        },
      );
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
      await revokeDetail({
        identityName: unlocked,
        path: revokePath,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Detail revoked');
      setRevokePath('');
      setRevokeReason('');
      await refresh();
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
      await revokeIdentity({
        identityName: unlocked,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Identity revoked');
      await refresh();
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
              navigation.popTo('IdentitiesHome');
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
      const unlocked = await ensureUnlocked(identity.name);
      if (!unlocked) return;
      const result = await requestVerifyEmail({
        identityName: identity.name,
        fingerprint: identity.fingerprint,
        detail: cleartext,
        path: verifyPath,
        server: serverUrl,
      });
      setStatus((result as {status?: string}).status === 'pending' ? 'Your existing verification link remains valid, or the recipient limit has been reached.' : `Verification email requested for ${cleartext}`);
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
        <StatusBanner
          message={
            profileError ||
            (loading ? 'Loading identity…' : 'Identity not found.')
          }
          kind={profileError || !loading ? 'error' : 'info'}
        />
      </Screen>
    );
  }

  const signingLabel =
    identity.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA';
  const detailPaths = localDetails.map(item => item.path);

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
      <StatusBanner
        message={status || profileError}
        kind={profileError && !status ? 'error' : statusKind(status)}
      />

      {route.name === 'IdentityDetails' && !sessionUnlocked ? (
        <AppButton
          title="Unlock to manage local details"
          testID="identity-unlock"
          onPress={onUnlock}
        />
      ) : null}

      {route.name === 'IdentityPublish' ? (
        <>
          <IdentityPublicationStatus
            publication={publication}
            locallyRevoked={locallyRevoked}
          />
          {publication.state === 'unavailable' ? (
            <AppButton
              title="Check status again"
              variant="secondary"
              onPress={() => {
                void refresh();
              }}
            />
          ) : null}
          {!locallyRevoked &&
          publication.state !== 'published' &&
          publication.state !== 'revoked' ? (
            <>
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
              {publication.state === 'unpublished' ||
              (publishServer.trim() &&
                publishServer.trim().replace(/\/+$/, '') !==
                  serverUrl.replace(/\/+$/, '')) ? (
                <AppButton
                  title="Publish to server"
                  testID="identity-publish"
                  onPress={onPublish}
                  disabled={busy}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {route.name === 'IdentityDetails' ? (
        <>
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
                {isEmailVerified(item, publication) ? (
                  <Text
                    style={styles.success}
                    testID={`identity-email-verified-${item.path}`}>
                    ✓ Email verified
                  </Text>
                ) : isDetailPublished(item, publication) &&
                  (item.path === 'email' || item.path === 'opaque::email') ? (
                  <AppButton
                    title="Verify email"
                    testID={`identity-verify-${item.path}`}
                    variant="secondary"
                    onPress={() => onVerifyEmail(item.path, item.detail)}
                  />
                ) : publication.state === 'published' &&
                  !isDetailPublished(item, publication) ? (
                  <AppButton
                    title="Publish detail"
                    testID={`identity-publish-detail-${item.path}`}
                    variant="secondary"
                    onPress={() => onPublishDetail(item.path)}
                  />
                ) : null}
              </Card>
            ))
          )}

          {sessionUnlocked ? (
            <>
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
            </>
          ) : null}
        </>
      ) : null}

      {route.name === 'IdentityExport' ? (
        <>
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
        </>
      ) : null}

      {route.name === 'IdentitySecurity' ? (
        <>
          <SectionTitle>Revocation</SectionTitle>
          {!sessionUnlocked ? (
            <AppButton title="Unlock to load detail paths" onPress={onUnlock} />
          ) : null}
          <Text style={styles.fieldLabel}>Detail path to revoke</Text>
          <Pressable
            testID="identity-revoke-path-picker"
            accessibilityRole="button"
            accessibilityState={{expanded: revokePathOpen}}
            onPress={() => setRevokePathOpen(open => !open)}
            style={styles.pickerTrigger}>
            <Text
              style={
                revokePath ? styles.pickerValue : styles.pickerPlaceholder
              }>
              {revokePath || 'Select a detail path…'}
            </Text>
            <Text style={styles.pickerChevron}>
              {revokePathOpen ? '▲' : '▼'}
            </Text>
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
                      index < detailPaths.length - 1 &&
                        styles.pickerItemDivider,
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
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  success: {color: colors.success, fontSize: 13, fontWeight: '600'},
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
