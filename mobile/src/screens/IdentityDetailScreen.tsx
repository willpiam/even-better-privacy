import React, {useEffect, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {listIdentities} from '../services/storage';
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
          <Text style={styles.detail} key={item.path}>
            {item.path}: {item.detail}
          </Text>
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
