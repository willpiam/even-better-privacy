import React, {useEffect, useState} from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {Identity} from '../ebpCore';
import {
  contactQrNameLimit,
  encodeContactQr,
  getContactQrEmail,
} from '../services/contactQr';
import {contactNfc, useContactNfcCapability} from '../services/contactNfc';
import {readIdentityRaw} from '../services/storage';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import QrCode, {qrImage} from '../components/QrCode';
import Screen from '../components/Screen';
import StatusBanner from '../components/StatusBanner';
import {colors, layout, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentityQr'>;

export default function IdentityQrScreen({route}: Props) {
  const {identityName} = route.params;
  const {width, height} = useWindowDimensions();
  const focused = useIsFocused();
  const canShareNfc = useContactNfcCapability('share');
  const [share, setShare] = useState<{
    fingerprint: string;
    email?: string;
    frames: string[];
    images: ReturnType<typeof qrImage>[];
  }>();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [sharingNfc, setSharingNfc] = useState(false);
  const [nfcError, setNfcError] = useState('');

  useEffect(() => {
    setSharingNfc(false);
    setNfcError('');
    if (!focused) return;
    let active = true;
    setShare(undefined);
    setIndex(0);
    setError('');
    const load = async () => {
      try {
        const pub = Identity.readPublicData(
          await readIdentityRaw(identityName),
        );
        if (!active) return;
        if (!pub) throw new Error('Could not read the public identity.');
        if (pub.revocationCertificate)
          throw new Error('This identity has been revoked.');
        const email = getContactQrEmail(pub);
        const frames = encodeContactQr(pub, identityName, email);
        setShare({
          fingerprint: pub.fingerprint,
          email,
          frames,
          images: frames.map(qrImage),
        });
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : 'Could not create the contact QR code.',
          );
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [focused, identityName]);

  useEffect(() => {
    if (!focused || !sharingNfc || !share || !contactNfc) return;
    const nfc = contactNfc;
    let active = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') setSharingNfc(false);
    });
    nfc.startSharing(share.frames.join('\n')).catch((e: unknown) => {
      if (active) {
        setNfcError(
          e instanceof Error ? e.message : 'Could not start NFC sharing.',
        );
        setSharingNfc(false);
      }
    });
    return () => {
      active = false;
      subscription.remove();
      nfc.stopSharing();
    };
  }, [focused, sharingNfc, share]);

  const count = share?.images.length ?? 0;
  useEffect(() => {
    if (!focused || sharingNfc || count < 2) return;
    const timer = setInterval(
      () => setIndex(current => (current + 1) % count),
      1100,
    );
    return () => clearInterval(timer);
  }, [focused, sharingNfc, count]);

  if (!share) {
    return (
      <Screen>
        <StatusBanner
          message={error || 'Preparing your contact QR code…'}
          kind={error ? 'error' : 'info'}
        />
      </Screen>
    );
  }

  const image = share.images[index];
  const size = Math.min(width - layout.gutter * 2, height * 0.65, 480);
  return (
    <Screen scroll>
      {canShareNfc ? (
        <AppButton
          title={sharingNfc ? 'Stop NFC sharing' : 'Share via NFC'}
          variant="secondary"
          testID="identity-share-nfc"
          onPress={() => {
            setNfcError('');
            setSharingNfc(current => !current);
          }}
        />
      ) : null}
      <StatusBanner message={nfcError} kind="error" />
      {sharingNfc ? (
        <Text style={styles.text}>
          On the other Android phone, open EBP, go to Contacts, tap +, and
          choose Receive via NFC. Hold the backs of the phones together until
          your contact details appear on their screen.
        </Text>
      ) : (
        <>
          <Text style={styles.text}>
            {share.email
              ? 'Share your public keys, name, and email address.'
              : 'Share your public keys and name.'}{' '}
            On the other device, open Contacts, tap +, and choose Scan contact
            QR. Hold this screen steady while the codes cycle.
          </Text>
          <View style={styles.code}>
            <QrCode image={image} size={size} label="Public identity QR code" />
            <Text style={styles.text}>{`Code ${index + 1} of ${count}`}</Text>
          </View>
        </>
      )}
      <Card padded>
        <Text style={styles.name}>
          {identityName.slice(0, contactQrNameLimit)}
        </Text>
        {share.email ? (
          <Text selectable style={styles.text}>
            {share.email}
          </Text>
        ) : null}
        <Text selectable style={styles.fingerprint}>
          {share.fingerprint}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {alignItems: 'center', gap: spacing.sm},
  text: {color: colors.muted, fontSize: typography.body},
  name: {color: colors.text, fontSize: typography.title, fontWeight: '600'},
  fingerprint: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
});
