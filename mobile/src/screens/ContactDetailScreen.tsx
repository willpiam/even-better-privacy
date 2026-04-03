import React, {useCallback, useEffect, useState} from 'react';
import {Button, SafeAreaView, ScrollView, StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {deleteContact, fetchContactFromServer, listContacts} from '../services/contacts';
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
    revoked?: boolean;
    revokedDetails?: string[];
  } | null>(null);

  const refresh = useCallback(async () => {
    const all = await listContacts();
    const found = all.find(item => item.name === route.params.name);
    if (!found) {
      setContact(null);
      return;
    }
    setContact({
      name: found.name,
      fingerprint: found.contact.fingerprint,
      signingKeyType: found.contact.signingKeyType,
      encryptionKeyType: found.contact.encryptionKeyType,
      details: found.contact.details ?? {},
      revoked: found.contact.revoked,
      revokedDetails: found.contact.revokedDetails ?? [],
    });
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
        <Text style={styles.text}>Signing: {contact.signingKeyType}</Text>
        <Text style={styles.text}>Encryption: {contact.encryptionKeyType}</Text>
        <Text style={styles.text}>Revoked: {contact.revoked ? 'Yes' : 'No'}</Text>
        <Text style={styles.section}>Details</Text>
        {Object.entries(contact.details).map(([path, [detail]]) => (
          <Text style={styles.detail} key={path}>
            {path}: {detail}
          </Text>
        ))}
        {!!contact.revokedDetails?.length && (
          <>
            <Text style={styles.section}>Revoked Details</Text>
            {contact.revokedDetails.map(path => (
              <Text style={styles.detail} key={path}>
                {path}
              </Text>
            ))}
          </>
        )}
        <Text style={styles.section}>Server API</Text>
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
  status: {marginTop: 10, color: '#111'},
});
