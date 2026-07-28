import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
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
import {resolveContactFingerprint} from '../services/contacts';
import {condenseFingerprint} from '../services/contactDisplay';
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
import ListRow from '../components/ListRow';
import ContactPicker from '../components/ContactPicker';
import BusyOverlay from '../components/BusyOverlay';
import {useSecretPrompt} from '../hooks/useSecretPrompt';
import {statusKind} from '../theme/statusKind';
import {colors, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Certificates'>;

type ActiveCert = {
  certificate: string;
  masterFingerprint: string;
  childFingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
};

type PendingProposal = {
  id: number;
  masterFingerprint: string;
  childFingerprint: string;
  proposerFingerprint: string;
  certificate: string;
  context: string;
  expiry: number;
  createdAt: number;
};

export default function CertificatesScreen(_props: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [active, setActive] = useState<ActiveCert[]>([]);
  const [pending, setPending] = useState<PendingProposal[]>([]);
  const [iAmMaster, setIAmMaster] = useState(true);
  const [otherParty, setOtherParty] = useState('');
  const [context, setContext] = useState('');
  const [expiry, setExpiry] = useState('');
  const [treeFingerprint, setTreeFingerprint] = useState('');
  const [treeOutput, setTreeOutput] = useState('');
  const [status, setStatus] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

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
      void (async () => {
        try {
          await refresh();
        } catch {
          // Ignore initial read failures.
        }
      })();
    }, [refresh]),
  );

  const onReload = async () => {
    try {
      await refresh();
      setStatus('Reloaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const currentFingerprint = async (): Promise<string> => {
    const identityName = await getCurrentIdentityRequired();
    const identities = await listIdentities();
    const meta = identities.find(item => item.name === identityName);
    if (!meta?.fingerprint) {
      throw new Error('Current identity fingerprint is unavailable');
    }
    return meta.fingerprint;
  };

  const onPropose = async () => {
    try {
      const myFingerprint = await currentFingerprint();
      const otherFingerprint = await resolveContactFingerprint(otherParty);
      if (!otherFingerprint) {
        setStatus('Other party fingerprint is required');
        return;
      }
      const password = await promptSecret({
        title: 'Identity password',
        placeholder: 'Identity password',
        submitLabel: 'Propose',
      });
      if (password === null) {
        return;
      }
      setBusyMessage('Creating proposal…');
      setStatus('');
      const identityName = await getCurrentIdentityRequired();
      const masterFingerprint = iAmMaster ? myFingerprint : otherFingerprint;
      const childFingerprint = iAmMaster ? otherFingerprint : myFingerprint;
      await proposeHierarchy({
        identityName,
        password,
        masterFingerprint,
        childFingerprint,
        context: context || undefined,
        expiry: expiry ? Number(expiry) : 0,
      });
      setStatus('Proposal created');
      setOtherParty('');
      setContext('');
      setExpiry('');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onAccept = async (proposalId: number) => {
    try {
      const password = await promptSecret({
        title: 'Identity password',
        placeholder: 'Identity password',
        submitLabel: 'Accept',
      });
      if (password === null) {
        return;
      }
      setBusyMessage('Accepting proposal…');
      setStatus('');
      const identityName = await getCurrentIdentityRequired();
      await acceptProposal({identityName, password, proposalId});
      setStatus('Proposal accepted');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onReject = async (proposalId: number) => {
    try {
      setBusyMessage('Rejecting proposal…');
      setStatus('');
      const rejectorFingerprint = await currentFingerprint();
      await rejectProposal({
        proposalId,
        rejectorFingerprint,
      });
      setStatus('Proposal rejected');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const onLoadTree = async () => {
    try {
      const fingerprint = await resolveContactFingerprint(treeFingerprint);
      if (!fingerprint) {
        setStatus('Fingerprint is required');
        return;
      }
      setBusyMessage('Loading hierarchy tree…');
      setStatus('');
      const tree = await getMergedHierarchyTree(fingerprint);
      setTreeOutput(JSON.stringify(tree, null, 2));
      setStatus(
        `Tree: root ${tree.root}, ${tree.relationships.length} relationship(s)`,
      );
    } catch (error) {
      setTreeOutput('');
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const busy = busyMessage !== null;

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {secretPrompt}
      <BusyOverlay visible={busy} message={busyMessage ?? undefined} />
      <ScrollView
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled">
        <StatusBanner message={status} kind={statusKind(status)} />
        <AppButton
          title="Reload Certificates"
          variant="secondary"
          onPress={onReload}
          disabled={busy}
        />

        <SectionTitle>Propose Hierarchy</SectionTitle>
        <Card padded style={styles.sectionCard}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>I am the Master</Text>
            <Switch value={iAmMaster} onValueChange={setIAmMaster} />
          </View>
          <Text style={styles.hint}>
            {iAmMaster
              ? 'Current identity will be master; pick the child below.'
              : 'Current identity will be child; pick the master below.'}
          </Text>
          <Text style={styles.fieldLabel}>Other party</Text>
          <ContactPicker
            value={otherParty}
            onChange={setOtherParty}
            selectValue="fingerprint"
            placeholder="Search contacts or paste fingerprint..."
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
          <AppButton
            title="Create Proposal"
            onPress={onPropose}
            disabled={busy}
          />
        </Card>

        <SectionTitle>Pending Proposals</SectionTitle>
        {pending.length === 0 ? (
          <Card padded>
            <Text style={styles.muted}>No pending proposals.</Text>
          </Card>
        ) : (
          <View style={styles.pendingStack}>
            {pending.map(item => (
              <Card key={item.id} padded>
                <Text style={styles.cardTitle}>#{item.id}</Text>
                <Text style={styles.small}>
                  Master: {condenseFingerprint(item.masterFingerprint)}
                </Text>
                <Text style={styles.small}>
                  Child: {condenseFingerprint(item.childFingerprint)}
                </Text>
                <Text style={styles.small}>
                  By: {condenseFingerprint(item.proposerFingerprint)}
                </Text>
                {item.context ? (
                  <Text style={styles.small}>Context: {item.context}</Text>
                ) : null}
                <View style={styles.row}>
                  <AppButton
                    title="Accept"
                    onPress={() => onAccept(item.id)}
                    style={styles.halfBtn}
                    disabled={busy}
                  />
                  <AppButton
                    title="Reject"
                    variant="danger"
                    onPress={() => onReject(item.id)}
                    style={styles.halfBtn}
                    disabled={busy}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}

        <SectionTitle>Hierarchy Tree</SectionTitle>
        <Card padded style={styles.sectionCard}>
          <Text style={styles.fieldLabel}>Fingerprint</Text>
          <ContactPicker
            value={treeFingerprint}
            onChange={setTreeFingerprint}
            selectValue="fingerprint"
            placeholder="Search contacts or paste fingerprint..."
          />
          <AppButton title="Load Tree" onPress={onLoadTree} disabled={busy} />
          {treeOutput ? (
            <TextField
              label="Tree output"
              value={treeOutput}
              editable={false}
              multiline
            />
          ) : null}
        </Card>

        <SectionTitle>Active Certificates</SectionTitle>
        {active.length === 0 ? (
          <Card padded>
            <Text style={styles.muted}>No active certificates.</Text>
          </Card>
        ) : (
          <Card>
            {active.map((item, index) => (
              <ListRow
                key={item.certificate}
                title={`${condenseFingerprint(item.masterFingerprint)} → ${condenseFingerprint(item.childFingerprint)}`}
                subtitle={[
                  item.context || 'No context',
                  item.expiry
                    ? `Expires ${new Date(item.expiry).toLocaleDateString()}`
                    : 'No expiry',
                ].join(' · ')}
                showChevron={false}
                showDivider={index < active.length - 1}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1, padding: 0},
  listContent: {padding: spacing.md, gap: 10, paddingBottom: 24},
  sectionCard: {gap: 10},
  pendingStack: {gap: 10},
  cardTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  small: {fontSize: typography.caption, color: colors.text, marginBottom: 2},
  muted: {fontSize: typography.caption, color: colors.muted},
  hint: {fontSize: 13, color: colors.muted},
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.page,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchLabel: {
    flex: 1,
    marginRight: 12,
    color: colors.text,
    fontSize: typography.body,
  },
  row: {flexDirection: 'row', gap: 8, marginTop: 8},
  halfBtn: {flex: 1},
});
