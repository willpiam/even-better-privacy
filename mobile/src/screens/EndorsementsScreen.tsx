import React, {useCallback, useRef, useState} from 'react';
import {Alert, StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import RNFS from 'react-native-fs';
import {
  endorsementId,
  MAX_ENDORSEMENT_BYTES,
  type EndorsementBundle,
} from '../../../core/PeerVerification.ts';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {useIdentityUnlock} from '../hooks/useIdentityUnlock';
import {
  importEndorsement,
  listEndorsements,
  saveEndorsementWithdrawal,
} from '../services/endorsements';
import {listContacts, type StoredContact} from '../services/contacts';
import {normalizeFileUri} from '../services/encryptDecryptLogic';
import {listIdentities} from '../services/storage';
import type {StoredIdentityMeta} from '../types';
import {pickToolFile, removeToolFile, shareToolFile} from './crypto/toolFiles';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import Screen from '../components/Screen';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<ContactsStackParamList, 'Endorsements'>;

export default function EndorsementsScreen({navigation, route}: Props) {
  const fingerprint = route.params?.fingerprint;
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [bundles, setBundles] = useState<EndorsementBundle[]>();
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [identities, setIdentities] = useState<StoredIdentityMeta[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    const [records, contactList, identityList] = await Promise.all([
      listEndorsements(fingerprint),
      listContacts(),
      listIdentities(),
    ]);
    setBundles(records);
    setContacts(contactList);
    setIdentities(identityList);
  }, [fingerprint]);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(cause =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
    }, [refresh]),
  );

  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const onImport = () =>
    run(async () => {
      const file = await pickToolFile();
      if (!file) return;
      try {
        const path = normalizeFileUri(file.uri);
        if (Number((await RNFS.stat(path)).size) > MAX_ENDORSEMENT_BYTES) {
          throw new Error('The endorsement file is too large.');
        }
        const bundle = await importEndorsement(
          await RNFS.readFile(path, 'utf8'),
        );
        await refresh();
        if (fingerprint && bundle.subject.fingerprint !== fingerprint) {
          navigation.push('Endorsements', {
            fingerprint: bundle.subject.fingerprint,
          });
        } else {
          setNotice(
            bundle.withdrawal
              ? 'Signed withdrawal imported.'
              : 'Signed endorsement imported.',
          );
        }
      } finally {
        removeToolFile(file.uri);
      }
    });

  const onShare = (bundle: EndorsementBundle) =>
    run(() =>
      shareToolFile(
        `ebp-endorsement-${endorsementId(bundle.endorsement).slice(
          0,
          12,
        )}.json`,
        JSON.stringify(bundle),
        'application/json',
        'utf8',
      ),
    );

  const onWithdraw = (bundle: EndorsementBundle, identityName: string) => {
    Alert.alert(
      'Withdraw this endorsement?',
      'This creates a signed withdrawal you can share with anyone who received the endorsement.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              if (!(await ensureUnlocked(identityName))) return;
              await saveEndorsementWithdrawal(identityName, bundle);
              await refresh();
              setNotice(
                'Withdrawal saved. Share it with anyone who received your endorsement.',
              );
            }),
        },
      ],
    );
  };

  const revoked = new Set([
    ...contacts
      .filter(item => item.contact.revoked)
      .map(item => item.contact.fingerprint),
    ...identities.filter(item => item.revoked).map(item => item.fingerprint),
  ]);

  return (
    <Screen scroll>
      <AppButton
        title="Import endorsement or withdrawal"
        variant="secondary"
        disabled={busy}
        onPress={onImport}
      />
      <StatusBanner message={error} kind="error" />
      <StatusBanner message={notice} kind="success" />
      {!bundles ? (
        error ? null : (
          <StatusBanner message="Loading endorsements…" kind="info" />
        )
      ) : bundles.length === 0 ? (
        <Text style={styles.text}>No endorsements saved.</Text>
      ) : (
        bundles.map(bundle => {
          const {endorsement, withdrawal} = bundle;
          const own = identities.find(
            identity => identity.fingerprint === endorsement.issuer,
          );
          const contact = contacts.find(
            item => item.contact.fingerprint === endorsement.issuer,
          );
          const signer = own
            ? `you (${own.name})`
            : contact?.localAlias || contact?.name;
          const issuerRevoked = revoked.has(endorsement.issuer);
          const subjectRevoked = revoked.has(endorsement.subject);
          return (
            <Card key={endorsementId(endorsement)} padded>
              <SectionTitle>{endorsement.name}</SectionTitle>
              <Text style={styles.text}>
                {withdrawal
                  ? 'Endorsement withdrawn'
                  : issuerRevoked || subjectRevoked
                  ? 'Endorsement of a revoked identity'
                  : `Verified in person by ${signer || 'the signer below'}`}
              </Text>
              {issuerRevoked ? (
                <StatusBanner
                  message="Signer’s identity revoked."
                  kind="error"
                />
              ) : null}
              {subjectRevoked ? (
                <StatusBanner
                  message="Contact’s identity revoked."
                  kind="error"
                />
              ) : null}
              <Text style={styles.text}>
                {new Date(endorsement.createdAt).toLocaleString()}
              </Text>
              <Text style={styles.text}>Signer fingerprint</Text>
              <Text selectable style={styles.fingerprint}>
                {endorsement.issuer}
              </Text>
              <Text style={styles.text}>Verified fingerprint</Text>
              <Text selectable style={styles.fingerprint}>
                {endorsement.subject}
              </Text>
              <AppButton
                title={
                  withdrawal ? 'Share signed withdrawal' : 'Share endorsement'
                }
                variant="secondary"
                disabled={busy}
                onPress={() => onShare(bundle)}
              />
              {own && !withdrawal ? (
                <AppButton
                  title="Withdraw endorsement"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onWithdraw(bundle, own.name)}
                />
              ) : null}
            </Card>
          );
        })
      )}
      {unlockPrompt}
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: {color: colors.muted, fontSize: typography.body},
  fingerprint: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
});
