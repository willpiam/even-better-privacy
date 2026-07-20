import React, {useCallback, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
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
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import Card from '../components/Card';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Certificates'>;

export default function CertificatesScreen(_props: Props): JSX.Element {
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
    <Screen style={styles.screen} contentStyle={styles.content}>
      <FlatList
        data={active}
        keyExtractor={item => item.certificate}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <StatusBanner message={status} kind={statusKind(status)} />
            <TextField
              label="Identity password"
              value={password}
              onChangeText={setPassword}
              placeholder="Identity password (for propose/accept)"
              secureTextEntry
            />
            <AppButton title="Reload Certificates" variant="secondary" onPress={onReload} />

            <SectionTitle>Propose Hierarchy</SectionTitle>
            <TextField
              label="Master fingerprint"
              value={masterFingerprint}
              onChangeText={setMasterFingerprint}
              placeholder="Master fingerprint"
              autoCapitalize="none"
            />
            <TextField
              label="Child fingerprint"
              value={childFingerprint}
              onChangeText={setChildFingerprint}
              placeholder="Child fingerprint"
              autoCapitalize="none"
            />
            <TextField
              label="Context"
              value={context}
              onChangeText={setContext}
              placeholder="Context (optional)"
            />
            <TextField
              label="Expiry"
              value={expiry}
              onChangeText={setExpiry}
              placeholder="Expiry ms unix timestamp (0 for none)"
              keyboardType="number-pad"
            />
            <AppButton title="Create Proposal" onPress={onPropose} />

            <SectionTitle>Pending Proposals</SectionTitle>
            {pending.length === 0 ? (
              <Text style={styles.small}>No pending proposals.</Text>
            ) : (
              pending.map(item => (
                <Card key={item.id} padded style={styles.cardGap}>
                  <Text style={styles.small}>#{item.id}</Text>
                  <Text style={styles.small}>{item.masterFingerprint}</Text>
                  <Text style={styles.small}>{item.childFingerprint}</Text>
                  <Text style={styles.small}>By: {item.proposerFingerprint}</Text>
                  <View style={styles.row}>
                    <AppButton
                      title="Accept"
                      onPress={() => onAccept(item.id)}
                      style={styles.halfBtn}
                    />
                    <AppButton
                      title="Reject"
                      variant="danger"
                      onPress={() => onReject(item.id)}
                      style={styles.halfBtn}
                    />
                  </View>
                </Card>
              ))
            )}

            <SectionTitle>Hierarchy Tree</SectionTitle>
            <TextField
              label="Fingerprint"
              value={treeFingerprint}
              onChangeText={setTreeFingerprint}
              placeholder="Fingerprint for hierarchy tree"
              autoCapitalize="none"
            />
            <AppButton title="Load Tree" onPress={onLoadTree} />
            <TextField
              label="Tree output"
              value={treeOutput}
              editable={false}
              multiline
            />

            <SectionTitle>Active Certificates</SectionTitle>
          </View>
        }
        ListEmptyComponent={<Text style={styles.small}>No active certificates.</Text>}
        renderItem={({item}) => (
          <Card padded style={styles.cardGap}>
            <Text style={styles.small}>Master: {item.masterFingerprint}</Text>
            <Text style={styles.small}>Child: {item.childFingerprint}</Text>
            <Text style={styles.small}>Context: {item.context || '(none)'}</Text>
            <Text style={styles.small}>
              Created: {new Date(item.timestamp).toISOString()}
            </Text>
            <Text style={styles.small}>
              Expiry:{' '}
              {item.expiry ? new Date(item.expiry).toISOString() : 'none'}
            </Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1, padding: 0},
  listContent: {padding: 12, gap: 10},
  headerBlock: {gap: 10, marginBottom: 8},
  cardGap: {marginBottom: 8},
  small: {fontSize: typography.caption, color: colors.text, marginBottom: 2},
  row: {flexDirection: 'row', gap: 8, marginTop: 8},
  halfBtn: {flex: 1},
});
