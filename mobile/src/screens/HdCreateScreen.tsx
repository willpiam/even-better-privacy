import React, {useState} from 'react';
import {Alert, StyleSheet, Switch, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {
  createHdIdentity,
  createHdMnemonic,
  discoverHdIdentities,
  verifyHdMnemonic,
} from '../services/hd';
import {getServerUrl} from '../services/settings';
import {
  fetchEbpSignupConfig,
  lookupVerifiedManagedEmail,
} from '../services/mail/ebpSignup';
import {managedMailboxRestoreHint} from '../services/mail/ebpSignupLogic';
import type {HdChange, HdProfile} from '../ebpCore';

async function managedMailboxHint(fingerprint: string): Promise<string> {
  const server = await getServerUrl();
  const cfg = await fetchEbpSignupConfig(server);
  if (!cfg.enabled) {
    return '';
  }
  const email = await lookupVerifiedManagedEmail(server, fingerprint, cfg.domain);
  return email ? managedMailboxRestoreHint(email) : '';
}
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SegmentedControl from '../components/SegmentedControl';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import Card from '../components/Card';
import {statusKind} from '../theme/statusKind';
import {colors} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'HdCreate'>;

export default function HdCreateScreen({navigation}: Props): JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [confirmMnemonic, setConfirmMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [profile, setProfile] = useState<HdProfile>('dilithium');
  const [change, setChange] = useState<HdChange>('external');
  const [overwrite, setOverwrite] = useState(false);
  const [account, setAccount] = useState('0');
  const [index, setIndex] = useState('0');
  const [discoverOutput, setDiscoverOutput] = useState('');
  const [mailboxHint, setMailboxHint] = useState('');
  const [createdName, setCreatedName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Working…');

  const onGenerate = () => {
    const next = createHdMnemonic(256);
    setMnemonic(next);
    setConfirmMnemonic(next);
    setStatus('Mnemonic generated — write it down before continuing');
  };

  const runCreate = async () => {
    setBusy(true);
    setBusyMessage('Creating HD identity…');
    setStatus('');
    setMailboxHint('');
    try {
      if (mnemonic.trim() !== confirmMnemonic.trim()) {
        throw new Error('Mnemonic confirmation does not match');
      }
      if (!verifyHdMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
      }
      const created = await createHdIdentity({
        name,
        mnemonic,
        passphrase,
        password,
        profile,
        account: Number(account) || 0,
        change,
        index: Number(index) || 0,
        overwrite,
      });
      setStatus(`Created HD identity ${created.name}`);
      let hint = '';
      try {
        hint = await managedMailboxHint(created.fingerprint);
      } catch {
        hint = '';
      }
      if (hint) {
        setMailboxHint(hint);
        setCreatedName(created.name);
      } else {
        navigation.replace('IdentityDetail', {identityName: created.name});
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () => {
    if (overwrite) {
      Alert.alert(
        'Overwrite identity?',
        `Replace any existing identity named "${name.trim()}"?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Overwrite',
            style: 'destructive',
            onPress: () => void runCreate(),
          },
        ],
      );
      return;
    }
    void runCreate();
  };

  const onDiscover = async () => {
    setBusy(true);
    setBusyMessage('Discovering on server…');
    setStatus('');
    setMailboxHint('');
    try {
      const matches = await discoverHdIdentities({
        mnemonic,
        passphrase,
        profile,
        account: Number(account) || 0,
      });
      setDiscoverOutput(JSON.stringify(matches, null, 2));
      let hint = '';
      for (const match of matches) {
        if (!match.publishedToServer) {
          continue;
        }
        try {
          hint = await managedMailboxHint(match.fingerprint);
        } catch {
          hint = '';
        }
        if (hint) {
          break;
        }
      }
      setMailboxHint(hint);
      setStatus(`Discovery found ${matches.length} match(es)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message={busyMessage} />
      <StatusBanner message={status} kind={statusKind(status)} />
      {mailboxHint ? (
        <Text testID="hd-mailbox-restore-hint" style={styles.hint}>
          {mailboxHint}
        </Text>
      ) : null}
      {createdName && mailboxHint ? (
        <AppButton
          title="View identity"
          onPress={() =>
            navigation.replace('IdentityDetail', {identityName: createdName})
          }
        />
      ) : null}
      <AppButton
        title="Generate mnemonic"
        testID="hd-generate-mnemonic"
        variant="secondary"
        onPress={onGenerate}
      />
      {words.length >= 12 ? (
        <Card padded>
          <Text style={styles.hint}>
            Write these words down offline. You will confirm them below.
          </Text>
          <View style={styles.wordGrid}>
            {words.map((word, i) => (
              <Text key={`${i}-${word}`} style={styles.word}>
                {i + 1}. {word}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      <TextField
        label="Mnemonic"
        testID="hd-mnemonic"
        value={mnemonic}
        onChangeText={setMnemonic}
        multiline
        autoCapitalize="none"
      />
      <TextField
        label="Confirm mnemonic"
        testID="hd-confirm-mnemonic"
        value={confirmMnemonic}
        onChangeText={setConfirmMnemonic}
        multiline
        autoCapitalize="none"
      />
      <TextField
        label="Optional passphrase"
        testID="hd-passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
      />
      <TextField
        label="Identity name"
        testID="hd-identity-name"
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
      />
      <TextField
        label="Encryption password"
        testID="hd-password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <SectionTitle>Profile</SectionTitle>
      <SegmentedControl
        value={profile}
        onChange={v => setProfile(v as HdProfile)}
        options={[
          {label: 'ML-DSA', value: 'dilithium'},
          {label: 'SLH-DSA', value: 'sphincs'},
        ]}
      />
      <SectionTitle>Change chain</SectionTitle>
      <Text style={styles.changeHint}>
        Internal/recovery identities are not for publication. Discover uses the
        external chain.
      </Text>
      <SegmentedControl
        testID="hd-change"
        value={change}
        onChange={v => setChange(v as HdChange)}
        options={[
          {label: 'External', value: 'external'},
          {label: 'Internal', value: 'internal'},
        ]}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Account" value={account} onChangeText={setAccount} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label="Index" value={index} onChangeText={setIndex} keyboardType="number-pad" />
        </View>
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Overwrite if exists</Text>
        <Switch
          testID="hd-overwrite"
          value={overwrite}
          onValueChange={setOverwrite}
        />
      </View>
      <AppButton
        title="Create HD identity"
        testID="hd-create-submit"
        onPress={onCreate}
        disabled={busy}
      />
      <AppButton title="Discover on server" variant="secondary" onPress={onDiscover} disabled={busy} />
      {discoverOutput ? (
        <TextField label="Discovery output" value={discoverOutput} editable={false} multiline />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {fontSize: 13, color: colors.accent, marginBottom: 10, lineHeight: 18},
  changeHint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 8,
    lineHeight: 17,
  },
  wordGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  word: {width: '47%', fontSize: 13, color: colors.text},
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
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
