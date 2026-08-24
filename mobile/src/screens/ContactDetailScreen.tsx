import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {
  deleteContact,
  fetchContactFromServer,
  listContacts,
  resolveOpaqueDetail,
  updateContactLocalNotes,
} from '../services/contacts';
import {getServerUrl} from '../services/settings';
import Screen from '../components/Screen';
import Card from '../components/Card';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import {colors, typography} from '../theme/tokens';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactDetail'>;

function isOpaquePath(path: string): boolean {
  return path.startsWith('opaque::');
}

function formatOpaqueHash(value: string): string {
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function showDetailRawInfo(
  path: string,
  value: string,
  proof: string,
  resolved?: string,
): void {
  const lines: string[] = [];
  if (resolved) {
    lines.push(`Resolved: ${resolved}`);
  }
  if (isOpaquePath(path)) {
    lines.push(`Hash: ${value}`);
  } else {
    lines.push(`Value: ${value}`);
  }
  if (proof) {
    lines.push(`Proof: ${proof}`);
  }
  Alert.alert(path, lines.join('\n\n'));
}

export default function ContactDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
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
    setSyncing(true);
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
    } finally {
      setSyncing(false);
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
      <Screen>
        <StatusBanner message="Contact not found." kind="error" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BusyOverlay visible={syncing} message="Syncing contact…" />
      <Card padded>
        <Text style={styles.name}>{contact.name}</Text>
        {contact.localAlias ? (
          <Text style={styles.meta}>Alias: {contact.localAlias}</Text>
        ) : null}
        <Text style={styles.fp}>{contact.fingerprint}</Text>
        <Text style={styles.meta}>
          {contact.signingKeyType}/{contact.encryptionKeyType}
        </Text>
      </Card>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Details</SectionTitle>
      {Object.keys(contact.details).length === 0 ? (
        <Text style={styles.meta}>No published details.</Text>
      ) : (
        Object.entries(contact.details).map(([path, entry]) => {
          const value = Array.isArray(entry) ? entry[0] ?? '' : String(entry);
          const proof = Array.isArray(entry) ? entry[1] ?? '' : '';
          const opaque = isOpaquePath(path);
          const resolved = contact.resolvedOpaqueDetails?.[path];
          let displayValue = value;
          let badge: string | null = null;
          if (opaque && resolved) {
            displayValue = resolved;
            badge = 'resolved';
          } else if (opaque) {
            displayValue = formatOpaqueHash(value);
            badge = 'hash';
          }
          return (
            <Card key={path} padded style={styles.detailCard}>
              <View style={styles.detailRow}>
                <View style={styles.detailMain}>
                  <Text style={styles.detailPath}>{path}</Text>
                  <Text style={styles.detailValue} selectable>
                    {displayValue}
                  </Text>
                  {badge ? <Text style={styles.detailBadge}>{badge}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Raw details for ${path}`}
                  hitSlop={8}
                  onPress={() =>
                    showDetailRawInfo(path, value, proof, resolved)
                  }
                  style={({pressed}) => [
                    styles.infoBtn,
                    pressed && styles.infoBtnPressed,
                  ]}>
                  <Text style={styles.infoBtnLabel}>i</Text>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}

      <SectionTitle>Resolve opaque detail</SectionTitle>
      <TextField
        label="opaque:: path"
        value={opaquePath}
        onChangeText={setOpaquePath}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Plaintext value"
        value={opaqueValue}
        onChangeText={setOpaqueValue}
        autoCapitalize="none"
      />

      <SectionTitle>Local notes</SectionTitle>
      <TextField
        label="Alias"
        testID="contact-notes-alias"
        value={localAlias}
        onChangeText={setLocalAlias}
      />
      <TextField
        label="Description"
        value={localDescription}
        onChangeText={setLocalDescription}
        multiline
      />
      <TextField
        label="Local email"
        value={localEmail}
        onChangeText={setLocalEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <AppButton
        title="Save notes"
        testID="contact-notes-save"
        onPress={onSaveNotes}
      />

      <Text style={styles.meta}>
        {`${serverUrl}/api/v1/identity/${contact.fingerprint}`}
      </Text>
      <View style={styles.row}>
        <AppButton
          title="Sync"
          onPress={onSync}
          disabled={syncing}
          style={styles.flex}
        />
        <AppButton
          title="Opaque resolve"
          variant="secondary"
          onPress={onResolveOpaque}
          disabled={syncing}
          style={styles.flex}
        />
      </View>
      <AppButton
        title="Delete"
        testID="contact-delete"
        variant="danger"
        onPress={onDelete}
        disabled={syncing}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: {
    fontWeight: '700',
    fontSize: 18,
    color: colors.text,
  },
  fp: {
    marginTop: 8,
    fontSize: typography.caption,
    color: colors.muted,
    fontFamily: 'monospace',
  },
  meta: {
    marginTop: 6,
    fontSize: typography.caption,
    color: colors.muted,
  },
  detailCard: {marginBottom: 0},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  detailMain: {
    flex: 1,
    minWidth: 0,
  },
  detailPath: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: typography.body,
    color: colors.text,
    lineHeight: 20,
  },
  detailBadge: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  infoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  infoBtnPressed: {
    backgroundColor: colors.accentSoft,
  },
  infoBtnLabel: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
});
