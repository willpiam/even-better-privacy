import React, {useCallback, useEffect, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {
  deleteContact,
  fetchContactFromServer,
  listContacts,
  resolveOpaqueDetail,
  updateContactLocalNotes,
} from '../services/contacts';
import {getServerUrl} from '../services/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'ContactDetail'>;

export default function ContactDetailScreen({route, navigation}: Props): JSX.Element {
  const [status, setStatus] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [contact, setContact] = useState<{
    name: string;
    fingerprint: string;
    signingKeyType: string;
    encryptionKeyType: string;
    details: Record<string, [string, string]>;
    resolvedOpaqueDetails?: Record<string, string>;
    localAlias?: string;
    localDescription?: string;
    localEmail?: string;
    revoked?: boolean;
    revokedDetails?: string[];
  } | null>(null);
  const [opaquePath, setOpaquePath] = useState('');
  const [opaqueValue, setOpaqueValue] = useState('');
  const [localAlias, setLocalAlias] = useState('');
  const [localDescription, setLocalDescription] = useState('');
  const [localEmail, setLocalEmail] = useState('');

  const refresh = useCallback(async () => {
    const all = await listContacts();
    const found = all.find(item => item.name === route.params.name);
    if (!found) {
      setContact(null);
      return;
    }
    const raw = found.contact as Record<string, unknown>;
    setContact({
      name: found.name,
      fingerprint: found.contact.fingerprint,
      signingKeyType: found.contact.signingKeyType,
      encryptionKeyType: found.contact.encryptionKeyType,
      details: found.contact.details ?? {},
      resolvedOpaqueDetails: found.contact.resolvedOpaqueDetails,
      localAlias: typeof raw.localAlias === 'string' ? raw.localAlias : undefined,
      localDescription:
        typeof raw.localDescription === 'string' ? raw.localDescription : undefined,
      localEmail: typeof raw.localEmail === 'string' ? raw.localEmail : undefined,
      revoked: found.contact.revoked,
      revokedDetails: found.contact.revokedDetails ?? [],
    });
    setLocalAlias(typeof raw.localAlias === 'string' ? raw.localAlias : '');
    setLocalDescription(
      typeof raw.localDescription === 'string' ? raw.localDescription : '',
    );
    setLocalEmail(typeof raw.localEmail === 'string' ? raw.localEmail : '');
  }, [route.params.name]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    void (async () => {
      setServerUrl(await getServerUrl());
    })();
  }, []);

  const onDelete = async () => {
    try {
      await deleteContact({name: route.params.name});
      navigation.goBack();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onSync = async () => {
    try {
      if (!contact) {
        throw new Error('Contact not found');
      }
      await fetchContactFromServer({
        fingerprint: contact.fingerprint,
        name: contact.name,
      });
      setStatus('Synced from server');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onResolveOpaque = async () => {
    try {
      if (!contact) {
        throw new Error('Contact not found');
      }
      await resolveOpaqueDetail({
        fingerprint: contact.fingerprint,
        path: opaquePath,
        value: opaqueValue,
      });
      setStatus('Opaque detail resolved');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onSaveNotes = async () => {
    try {
      if (!contact) {
        throw new Error('Contact not found');
      }
      await updateContactLocalNotes({
        fingerprint: contact.fingerprint,
        localAlias,
        localDescription,
        localEmail,
      });
      setStatus('Local notes saved');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  if (!contact) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.text}>Contact not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.name}>{contact.name}</Text>
        <Text style={styles.text}>Fingerprint: {contact.fingerprint}</Text>
        {contact.localAlias ? (
          <Text style={styles.text}>Alias: {contact.localAlias}</Text>
        ) : null}

        <Text style={styles.section}>Details</Text>
        {Object.entries(contact.details).map(([path, [hash, label]]) => (
          <Text style={styles.detail} key={path}>
            {path}: {label || hash}
            {contact.resolvedOpaqueDetails?.[path]
              ? ` (resolved: ${contact.resolvedOpaqueDetails[path]})`
              : ''}
          </Text>
        ))}

        <Text style={styles.section}>Resolve opaque detail</Text>
        <TextInput
          style={styles.input}
          value={opaquePath}
          onChangeText={setOpaquePath}
          placeholder="opaque:: path"
        />
        <TextInput
          style={styles.input}
          value={opaqueValue}
          onChangeText={setOpaqueValue}
          placeholder="Plaintext value"
        />
        <Button title="Resolve opaque" onPress={onResolveOpaque} />

        <Text style={styles.section}>Local notes</Text>
        <TextInput style={styles.input} value={localAlias} onChangeText={setLocalAlias} placeholder="Alias" />
        <TextInput
          style={styles.input}
          value={localDescription}
          onChangeText={setLocalDescription}
          placeholder="Description"
        />
        <TextInput style={styles.input} value={localEmail} onChangeText={setLocalEmail} placeholder="Local email" />
        <Button title="Save local notes" onPress={onSaveNotes} />

        <Text style={styles.section}>Server</Text>
        <Text style={styles.text}>{`${serverUrl}/api/v1/identity/${contact.fingerprint}`}</Text>
        <Button title="Sync from Server" onPress={onSync} />
        <Button title="Delete Contact" onPress={onDelete} color="#d11a2a" />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  name: {fontWeight: '700', fontSize: 20, marginBottom: 8, color: '#111'},
  text: {marginBottom: 6, color: '#111'},
  section: {marginTop: 12, marginBottom: 6, fontWeight: '700', color: '#111'},
  detail: {marginBottom: 4, color: '#333'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    color: '#111',
  },
  status: {marginTop: 10, color: '#111'},
});
