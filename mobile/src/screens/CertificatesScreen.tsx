import React, {useCallback, useState} from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  acceptProposal,
  getMergedHierarchyTree,
  listCertificates,
  listPending,
  proposeHierarchy,
  rejectProposal,
} from '../services/hierarchy';
import {
  getCurrentIdentity,
  getCurrentIdentityRequired,
  listIdentities,
} from '../services/storage';

export default function CertificatesScreen(): JSX.Element {
  const [password, setPassword] = useState('');
  const [active, setActive] = useState<
    Array<{
      certificate: string;
      masterFingerprint: string;
      childFingerprint: string;
      timestamp: number;
      expiry: number;
      context: string;
    }>
  >([]);
  const [pending, setPending] = useState<
    Array<{
      id: number;
      masterFingerprint: string;
      childFingerprint: string;
      proposerFingerprint: string;
      certificate: string;
      context: string;
      expiry: number;
      createdAt: number;
    }>
  >([]);
  const [masterFingerprint, setMasterFingerprint] = useState('');
  const [childFingerprint, setChildFingerprint] = useState('');
  const [context, setContext] = useState('');
  const [expiry, setExpiry] = useState('');
  const [treeFingerprint, setTreeFingerprint] = useState('');
  const [treeOutput, setTreeOutput] = useState('');
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    const current = await getCurrentIdentity();
    const identities = await listIdentities();
    const currentMeta = current
      ? identities.find(item => item.name === current)
      : undefined;
    setActive(await listCertificates());
    setPending(await listPending(currentMeta?.fingerprint));
  }, []);

  useFocusEffect(
    useCallback(() => {
      // If password is not set yet, we still show active local certificates.
      void (async () => {
        try {
          setActive(await listCertificates());
        } catch {
          // Ignore initial read failures.
        }
      })();
    }, []),
  );

  const onReload = async () => {
    try {
      await refresh();
      setStatus('Reloaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onPropose = async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
      await proposeHierarchy({
        identityName,
        password,
        masterFingerprint,
        childFingerprint,
        context: context || undefined,
        expiry: expiry ? Number(expiry) : 0,
      });
      setStatus('Proposal created');
      setMasterFingerprint('');
      setChildFingerprint('');
      setContext('');
      setExpiry('');
      await onReload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onAccept = async (proposalId: number) => {
    try {
      const identityName = await getCurrentIdentityRequired();
      await acceptProposal({identityName, password, proposalId});
      setStatus('Proposal accepted');
      await onReload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onReject = async (proposalId: number) => {
    try {
      const identityName = await getCurrentIdentityRequired();
      await rejectProposal({
        proposalId,
        identityName,
        password,
      });
      setStatus('Proposal rejected');
      await onReload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onLoadTree = async () => {
    try {
      const tree = await getMergedHierarchyTree(treeFingerprint);
      setTreeOutput(JSON.stringify(tree, null, 2));
      setStatus(
        `Tree: root ${tree.root}, ${tree.relationships.length} relationship(s)`,
      );
    } catch (error) {
      setTreeOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={active}
        keyExtractor={item => item.certificate}
        ListHeaderComponent={
          <View>
            <Text style={styles.header}>Certificates</Text>
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Identity password (for propose/accept)"
              secureTextEntry
            />
            <Button title="Reload Certificates" onPress={onReload} />

            <Text style={styles.section}>Propose Hierarchy</Text>
            <TextInput
              style={styles.input}
              value={masterFingerprint}
              onChangeText={setMasterFingerprint}
              placeholder="Master fingerprint"
            />
            <TextInput
              style={styles.input}
              value={childFingerprint}
              onChangeText={setChildFingerprint}
              placeholder="Child fingerprint"
            />
            <TextInput
              style={styles.input}
              value={context}
              onChangeText={setContext}
              placeholder="Context (optional)"
            />
            <TextInput
              style={styles.input}
              value={expiry}
              onChangeText={setExpiry}
              placeholder="Expiry ms unix timestamp (0 for none)"
            />
            <Button title="Create Proposal" onPress={onPropose} />

            <Text style={styles.section}>Pending Proposals</Text>
            {pending.map(item => (
              <View key={item.id} style={styles.pendingItem}>
                <Text style={styles.small}>#{item.id}</Text>
                <Text style={styles.small}>{item.masterFingerprint}</Text>
                <Text style={styles.small}>{item.childFingerprint}</Text>
                <Text style={styles.small}>By: {item.proposerFingerprint}</Text>
                <View style={styles.row}>
                  <Button title="Accept" onPress={() => onAccept(item.id)} />
                  <Button title="Reject" color="#d11a2a" onPress={() => onReject(item.id)} />
                </View>
              </View>
            ))}

            <Text style={styles.section}>Hierarchy Tree</Text>
            <TextInput
              style={styles.input}
              value={treeFingerprint}
              onChangeText={setTreeFingerprint}
              placeholder="Fingerprint for hierarchy tree"
            />
            <Button title="Load Tree" onPress={onLoadTree} />
            <TextInput style={[styles.input, styles.multi]} value={treeOutput} editable={false} multiline />

            <Text style={styles.section}>Active Certificates</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.small}>No active certificates.</Text>}
        renderItem={({item}) => (
          <View style={styles.item}>
            <Text style={styles.small}>Master: {item.masterFingerprint}</Text>
            <Text style={styles.small}>Child: {item.childFingerprint}</Text>
            <Text style={styles.small}>Context: {item.context || '(none)'}</Text>
            <Text style={styles.small}>Created: {new Date(item.timestamp).toISOString()}</Text>
            <Text style={styles.small}>Expiry: {item.expiry ? new Date(item.expiry).toISOString() : 'none'}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff', padding: 16},
  header: {fontWeight: '700', fontSize: 20, marginBottom: 8, color: '#111'},
  status: {marginBottom: 8, color: '#111'},
  section: {marginTop: 12, marginBottom: 6, fontWeight: '700', color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    color: '#111',
  },
  multi: {minHeight: 120, textAlignVertical: 'top'},
  item: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  pendingItem: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  small: {fontSize: 12, color: '#222', marginBottom: 2},
  row: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 6},
});
