import React, {useEffect, useState} from 'react';
import {Alert, StyleSheet, Switch, Text, View} from 'react-native';
import {pick, keepLocalCopy} from '@react-native-documents/picker';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  deleteIdentity,
  importIdentity,
  listIdentities,
  readIdentityRaw,
} from '../services/storage';
import {requestVerifyEmail} from '../services/contacts';
import {appendActivityLog} from '../services/activityLog';
import {publishIdentity} from '../services/publish';
import {getServerUrl} from '../services/settings';
import {addDetail, listDetails} from '../services/details';
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
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentityDetail'>;

export default function IdentityDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const [identity, setIdentity] = useState<StoredIdentityMeta | null>(null);
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<
    Array<{path: string; detail: string; proof: string}>
  >([]);
  const [detailPath, setDetailPath] = useState('');
  const [detailValue, setDetailValue] = useState('');
  const [detailPush, setDetailPush] = useState(false);
  const [revokePath, setRevokePath] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [revokePush, setRevokePush] = useState(false);
  const [exportOutput, setExportOutput] = useState('');
  const [emergencyOutput, setEmergencyOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Working…');

  useEffect(() => {
    navigation.setOptions({title: route.params.identityName});
  }, [navigation, route.params.identityName]);

  useEffect(() => {
    const load = async () => {
      const [all, server] = await Promise.all([
        listIdentities(),
        getServerUrl(),
      ]);
      setServerUrl(server);
      setIdentity(
        all.find(item => item.name === route.params.identityName) ?? null,
      );
      if (password) {
        try {
          setDetails(
            await listDetails({
              identityName: route.params.identityName,
              password,
            }),
          );
        } catch {
          setDetails([]);
        }
      }
    };
    void load();
  }, [route.params.identityName, password]);

  const onPublish = async () => {
    setBusy(true);
    setBusyMessage('Publishing…');
    setStatus('');
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      if (!password) {
        throw new Error('Password is required');
      }
      const fingerprint = await publishIdentity({
        identityName: identity.name,
        password,
        server: serverUrl,
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
      await addDetail({
        identityName: identity.name,
        password,
        path: detailPath,
        detail: detailValue,
        push: detailPush,
      });
      setStatus('Detail added');
      setDetailPath('');
      setDetailValue('');
      setDetails(
        await listDetails({
          identityName: identity.name,
          password,
        }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onExportPublic = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const publicIdentity = await exportPublicIdentity(identity.name);
      setExportOutput(JSON.stringify(publicIdentity, null, 2));
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
      await revokeDetail({
        identityName: identity.name,
        password,
        path: revokePath,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Detail revoked');
      setRevokePath('');
      setRevokeReason('');
      setDetails(
        await listDetails({
          identityName: identity.name,
          password,
        }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onRevokeIdentity = async () => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      await revokeIdentity({
        identityName: identity.name,
        password,
        reason: revokeReason || undefined,
        push: revokePush,
      });
      setStatus('Identity revoked');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onImport = async () => {
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
      await appendActivityLog(`Imported identity ${meta.name}`, 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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

  const onVerifyEmail = async (detail: string) => {
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      await requestVerifyEmail({
        fingerprint: identity.fingerprint,
        detail,
        server: serverUrl,
      });
      setStatus(`Verification email requested for ${detail}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onEmergencyCert = async () => {
    setBusy(true);
    setBusyMessage('Generating certificate…');
    try {
      if (!identity) {
        throw new Error('Identity not found');
      }
      const cert = await generateEmergencyCert({
        identityName: identity.name,
        password,
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
        <StatusBanner message="Identity not found." kind="error" />
      </Screen>
    );
  }

  const signingLabel =
    identity.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA';

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage} />
      <Card padded>
        <Text style={styles.name}>{identity.name}</Text>
        <Text style={styles.meta}>
          {signingLabel} · {identity.encryptionKeyType}
        </Text>
        <Text style={styles.fp}>{identity.fingerprint}</Text>
        <Text style={styles.meta}>Server: {serverUrl || '—'}</Text>
      </Card>
      <StatusBanner message={status} kind={statusKind(status)} />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      <AppButton title="Publish to server" onPress={onPublish} disabled={busy} />
      <View style={styles.row}>
        <AppButton
          title="Export"
          variant="secondary"
          onPress={onExportFile}
          style={styles.flex}
        />
        <AppButton
          title="Import"
          variant="secondary"
          onPress={onImport}
          style={styles.flex}
        />
      </View>
      <AppButton
        title="Emergency certificate"
        variant="secondary"
        onPress={onEmergencyCert}
      />
      <AppButton
        title="Export public JSON"
        variant="secondary"
        onPress={onExportPublic}
      />
      {exportOutput ? (
        <TextField label="Public JSON" value={exportOutput} editable={false} multiline />
      ) : null}
      {emergencyOutput ? (
        <TextField
          label="Emergency certificate"
          value={emergencyOutput}
          editable={false}
          multiline
        />
      ) : null}

      <SectionTitle>Identity details</SectionTitle>
      {details.map(item => (
        <Card key={item.path} padded style={styles.detailCard}>
          <Text style={styles.detail}>
            {item.path}: {item.detail}
          </Text>
          {item.path.startsWith('email') || item.path.includes('email') ? (
            <AppButton
              title="Verify email"
              variant="secondary"
              onPress={() => onVerifyEmail(item.detail)}
            />
          ) : null}
        </Card>
      ))}
      <TextField
        label="Detail path"
        value={detailPath}
        onChangeText={setDetailPath}
        placeholder="e.g. email"
      />
      <TextField
        label="Detail value"
        value={detailValue}
        onChangeText={setDetailValue}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Push to server</Text>
        <Switch value={detailPush} onValueChange={setDetailPush} />
      </View>
      <AppButton title="Add detail" variant="secondary" onPress={onAddDetail} />

      <SectionTitle>Revocation</SectionTitle>
      <TextField
        label="Detail path to revoke"
        value={revokePath}
        onChangeText={setRevokePath}
      />
      <TextField
        label="Reason (optional)"
        value={revokeReason}
        onChangeText={setRevokeReason}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Push to server</Text>
        <Switch value={revokePush} onValueChange={setRevokePush} />
      </View>
      <AppButton title="Revoke detail" variant="secondary" onPress={onRevokeDetail} />
      <AppButton title="Revoke identity" variant="danger" onPress={onRevokeIdentity} />
      <AppButton title="Delete from device" variant="danger" onPress={onDelete} />
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
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
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
});
