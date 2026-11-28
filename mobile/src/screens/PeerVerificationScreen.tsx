import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  parseVerificationOffer,
  verificationCode,
  verificationSession,
  VERIFIED_NAME_LIMIT,
  verifyPeerProof,
  type VerificationOffer,
  type VerificationProof,
} from '../../../core/PeerVerification.ts';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {useIdentityUnlock} from '../hooks/useIdentityUnlock';
import {
  createPeerProof,
  savePeerEndorsement,
  startPeerVerification,
  type LocalVerification,
} from '../services/endorsements';
import {
  MAX_NFC_PAYLOAD_BYTES,
  useContactNfcCapability,
} from '../services/contactNfc';
import {
  encodeVerificationFrames,
  type VerificationPart,
} from '../services/verificationTransfer';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import Screen from '../components/Screen';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import TextField from '../components/TextField';
import VerificationExchange, {
  type ExchangeMode,
} from '../components/VerificationExchange';
import {colors, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<ContactsStackParamList, 'PeerVerification'>;

export default function PeerVerificationScreen({navigation, route}: Props) {
  const expectedFingerprint = route.params?.fingerprint;
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const canShareNfc = useContactNfcCapability('share');
  const canReceiveNfc = useContactNfcCapability('receive');
  const [local, setLocal] = useState<LocalVerification>();
  const [peer, setPeer] = useState<VerificationOffer>();
  const [localProof, setLocalProof] = useState<VerificationProof>();
  const [peerProof, setPeerProof] = useState<VerificationProof>();
  const [exchange, setExchange] = useState<ExchangeMode>();
  const [verifiedName, setVerifiedName] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);

  useEffect(() => {
    let active = true;
    startPeerVerification().then(
      session => {
        if (active) setLocal(session);
      },
      cause => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const offerFrames = useMemo(
    () => (local ? encodeVerificationFrames('offer', local.offer) : undefined),
    [local],
  );
  const proofFrames = useMemo(
    () =>
      localProof ? encodeVerificationFrames('proof', localProof) : undefined,
    [localProof],
  );

  const restart = () => {
    setLocal(undefined);
    setPeer(undefined);
    setLocalProof(undefined);
    setPeerProof(undefined);
    setExchange(undefined);
    setVerifiedName('');
    setSaved(false);
    setError('');
    setAttempt(current => current + 1);
  };

  const readExchange = (part: VerificationPart, data: string) => {
    if (!local) return;
    if (part === 'offer') {
      const offer = parseVerificationOffer(data);
      if (
        expectedFingerprint &&
        offer.identity.fingerprint !== expectedFingerprint
      ) {
        throw new Error('This offer is for a different contact fingerprint.');
      }
      verificationSession(local.offer, offer);
      setPeer(offer);
      setVerifiedName(offer.name);
    } else if (peer) {
      setPeerProof(verifyPeerProof(data, local.offer, peer));
    }
    setExchange(undefined);
    setError('');
  };

  const sign = async (what: 'proof' | 'endorsement') => {
    if (!local || !peer || actionPending.current) return;
    actionPending.current = true;
    setError('');
    setBusy(true);
    try {
      if (!(await ensureUnlocked(local.identityName))) return;
      if (what === 'proof') {
        setLocalProof(await createPeerProof(local, peer));
      } else if (peerProof) {
        await savePeerEndorsement(local, peer, peerProof, verifiedName);
        setSaved(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };

  const exchangeButtons = (
    part: VerificationPart,
    frames?: string[],
    received?: boolean,
  ) => {
    const fitsNfc = frames && frames.join('\n').length <= MAX_NFC_PAYLOAD_BYTES;
    return (
      <View style={styles.actions}>
        {frames ? (
          <AppButton
            title={`Show my ${part} QR`}
            variant="secondary"
            onPress={() => setExchange({mode: 'show', part, frames})}
            disabled={busy}
          />
        ) : null}
        {canShareNfc && fitsNfc ? (
          <AppButton
            title={`Share my ${part} via NFC`}
            variant="secondary"
            onPress={() => setExchange({mode: 'share', part, frames})}
            disabled={busy}
          />
        ) : null}
        {canShareNfc && frames && !fitsNfc ? (
          <Text style={styles.text}>
            This {part} is too large for NFC. Share it by QR.
          </Text>
        ) : null}
        {!received ? (
          <AppButton
            title={`Scan their ${part} QR`}
            variant="secondary"
            onPress={() => setExchange({mode: 'scan', part})}
            disabled={busy}
          />
        ) : null}
        {!received && canReceiveNfc ? (
          <AppButton
            title={`Receive their ${part} via NFC`}
            variant="secondary"
            onPress={() => setExchange({mode: 'receive', part})}
            disabled={busy}
          />
        ) : null}
      </View>
    );
  };

  if (exchange) {
    return (
      <Screen scroll>
        <VerificationExchange
          exchange={exchange}
          onRead={readExchange}
          onClose={() => setExchange(undefined)}
        />
      </Screen>
    );
  }

  if (!local) {
    return (
      <Screen>
        <StatusBanner
          message={error || 'Preparing verification…'}
          kind={error ? 'error' : 'info'}
        />
        {error ? <AppButton title="Try again" onPress={restart} /> : null}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.text}>Verifying as {local.identityName}</Text>
      <StatusBanner message={error} kind="error" />
      {saved ? (
        <>
          <StatusBanner
            message="Signed endorsement saved privately."
            kind="success"
          />
          <Text style={styles.text}>
            If the other person still needs your proof, share it before leaving.
          </Text>
          {exchangeButtons('proof', proofFrames, true)}
          <AppButton
            title="View endorsement"
            onPress={() =>
              navigation.replace('Endorsements', {
                fingerprint: peer?.identity.fingerprint,
              })
            }
          />
        </>
      ) : (
        <>
          <SectionTitle>Exchange offers</SectionTitle>
          <Text style={styles.text}>
            Each person opens Verify in person and sends their offer to the
            other phone.
          </Text>
          {exchangeButtons('offer', offerFrames, !!peer)}
          {peer ? (
            <>
              <Card padded>
                <SectionTitle>{peer.name}</SectionTitle>
                <Text selectable style={styles.fingerprint}>
                  {peer.identity.fingerprint}
                </Text>
              </Card>
              <SectionTitle>Exchange proofs</SectionTitle>
              <Text style={styles.text}>
                Once both phones have received an offer, sign and exchange
                proofs.
              </Text>
              {!localProof ? (
                <AppButton
                  title="Sign my proof"
                  onPress={() => sign('proof')}
                  loading={busy}
                />
              ) : null}
              {exchangeButtons('proof', proofFrames, !!peerProof)}
              {peerProof ? (
                <StatusBanner
                  message="Their signing key proof is valid."
                  kind="success"
                />
              ) : null}
              {localProof && peerProof ? (
                <>
                  <Card padded>
                    <SectionTitle>
                      Compare this code on both phones
                    </SectionTitle>
                    <Text style={styles.code}>
                      {verificationCode(verificationSession(local.offer, peer))}
                    </Text>
                  </Card>
                  <Text style={styles.text}>
                    Check every group matches and confirm the name or handle
                    with the person in front of you.
                  </Text>
                  <TextField
                    label="Name or handle you verified"
                    value={verifiedName}
                    onChangeText={setVerifiedName}
                    maxLength={VERIFIED_NAME_LIMIT}
                    editable={!busy}
                  />
                  <AppButton
                    title="Codes match · Sign endorsement"
                    loading={busy}
                    disabled={!verifiedName.trim()}
                    onPress={() => sign('endorsement')}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <AppButton
            title="Start over"
            variant="secondary"
            disabled={busy}
            onPress={restart}
          />
        </>
      )}
      {unlockPrompt}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {gap: spacing.sm},
  text: {color: colors.muted, fontSize: typography.body},
  fingerprint: {
    color: colors.muted,
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  code: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.title,
  },
});
