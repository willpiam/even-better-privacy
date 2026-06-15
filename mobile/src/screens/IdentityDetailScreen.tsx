import React, {useEffect, useState} from 'react';
import {
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import {pick, keepLocalCopy} from '@react-native-documents/picker';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
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

type Props = NativeStackScreenProps<RootStackParamList, 'IdentityDetail'>;

export default function IdentityDetailScreen({route}: Props): JSX.Element {
  const [identity, setIdentity] = useState<StoredIdentityMeta | null>(null);
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<
    Array<{path: string; detail: string; proof: string}>
  >([]);
  const [detailPath, setDetailPath] = useState('');
  const [detailValue, setDetailValue] = useState('');
  const [detailPush, setDetailPush] = useState('false');
  const [revokePath, setRevokePath] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [revokePush, setRevokePush] = useState('false');
  const [exportOutput, setExportOutput] = useState('');
  const [emergencyOutput, setEmergencyOutput] = useState('');
  const [loading, setLoading] = useState(false);

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
    load();
  }, [route.params.identityName, password]);

  const onPublish = async () => {
    setLoading(true);
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
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    } finally {
      setLoading(false);
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
        push: detailPush === 'true',
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
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
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
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
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
        push: revokePush === 'true',
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
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
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
        push: revokePush === 'true',
      });
      setStatus('Identity revoked');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    }
  };

  const onImport = async () => {
    try {
      const [file] = await pick({mode: 'import'});
      const [copy] = await keepLocalCopy({
        destination: 'cachesDirectory',
        files: [{uri: file.uri, fileName: file.name ?? 'identity.json'}],
      });
      const path = copy.uri.startsWith('file://')
        ? copy.uri.replace('file://', '')
        : copy.uri;
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
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    }
  };

  if (!identity) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{color: '#111'}}>Identity not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.name}>{identity.name}</Text>
        <Text style={styles.line}>Fingerprint: {identity.fingerprint}</Text>
        <Text style={styles.line}>Signing: {identity.signingKeyType}</Text>
        <Text style={styles.line}>Encryption: {identity.encryptionKeyType}</Text>
        <Text style={styles.line}>Server: {serverUrl}</Text>
        <Text style={styles.label}>Password to decrypt and sign</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />
        <Button
          title={loading ? 'Publishing...' : 'Publish to key server'}
          onPress={onPublish}
        />

        <Text style={styles.section}>Import / Export</Text>
        <Button title="Import identity file" onPress={onImport} />
        <Button title="Export encrypted identity" onPress={onExportFile} />
        <Button title="Delete identity" color="#d11a2a" onPress={onDelete} />

        <Text style={styles.section}>Export Public Identity</Text>
        <Button title="Export Public JSON" onPress={onExportPublic} />
        <TextInput
          value={exportOutput}
          editable={false}
          multiline
          style={[styles.input, styles.multi]}
        />

        <Text style={styles.section}>Identity Details</Text>
        {details.map(item => (
          <View key={item.path} style={styles.detailRow}>
            <Text style={styles.detail}>
              {item.path}: {item.detail}
            </Text>
            {item.path.startsWith('email') || item.path.includes('email') ? (
              <Button
                title="Verify email"
                onPress={() => onVerifyEmail(item.detail)}
              />
            ) : null}
          </View>
        ))}
        <TextInput
          value={detailPath}
          onChangeText={setDetailPath}
          style={styles.input}
          placeholder="Detail path (e.g. email)"
        />
        <TextInput
          value={detailValue}
          onChangeText={setDetailValue}
          style={styles.input}
          placeholder="Detail value"
        />
        <TextInput
          value={detailPush}
          onChangeText={setDetailPush}
          style={styles.input}
          placeholder="Push to server: true or false"
        />
        <Button title="Add Detail" onPress={onAddDetail} />

        <Text style={styles.section}>Revocation</Text>
        <TextInput
          value={revokePath}
          onChangeText={setRevokePath}
          style={styles.input}
          placeholder="Detail path to revoke"
        />
        <TextInput
          value={revokeReason}
          onChangeText={setRevokeReason}
          style={styles.input}
          placeholder="Revocation reason (optional)"
        />
        <TextInput
          value={revokePush}
          onChangeText={setRevokePush}
          style={styles.input}
          placeholder="Push to server: true or false"
        />
        <Button title="Revoke Detail" onPress={onRevokeDetail} />
        <Button title="Revoke Identity" color="#d11a2a" onPress={onRevokeIdentity} />

        <Text style={styles.section}>Emergency Revocation Certificate</Text>
        <Button title="Generate Emergency Certificate" onPress={onEmergencyCert} />
        <TextInput
          value={emergencyOutput}
          editable={false}
          multiline
          style={[styles.input, styles.multi]}
        />

        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  name: {fontWeight: '700', fontSize: 20, marginBottom: 8, color: '#111'},
  line: {marginBottom: 8, color: '#111'},
  section: {marginTop: 12, marginBottom: 6, fontWeight: '700', color: '#111'},
  detail: {marginBottom: 4, color: '#222'},
  detailRow: {marginBottom: 8},
  label: {marginTop: 12, marginBottom: 4, color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    color: '#111',
  },
  multi: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  status: {marginTop: 12, color: '#111'},
});
