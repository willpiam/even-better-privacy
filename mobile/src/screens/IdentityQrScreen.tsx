import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import qrcode from 'qrcode-generator';
import Svg, {Path, Rect} from 'react-native-svg';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {Identity} from '../ebpCore';
import {
  contactQrNameLimit,
  encodeContactQr,
  getContactQrEmail,
} from '../services/contactQr';
import {readIdentityRaw} from '../services/storage';
import Card from '../components/Card';
import Screen from '../components/Screen';
import StatusBanner from '../components/StatusBanner';
import {colors, layout, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentityQr'>;

function qrImage(value: string) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const modules = qr.getModuleCount();
  const path: string[] = [];
  // Four white modules around the matrix give scanners the required quiet zone.
  const margin = 4;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col))
        path.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return {path: path.join(''), size: modules + margin * 2};
}

export default function IdentityQrScreen({route}: Props) {
  const {identityName} = route.params;
  const {width, height} = useWindowDimensions();
  const focused = useIsFocused();
  const [share, setShare] = useState<{
    fingerprint: string;
    email?: string;
    images: ReturnType<typeof qrImage>[];
  }>();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
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
        setShare({
          fingerprint: pub.fingerprint,
          email,
          images: encodeContactQr(pub, identityName, email).map(qrImage),
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

  const count = share?.images.length ?? 0;
  useEffect(() => {
    if (!focused || count < 2) return;
    const timer = setInterval(
      () => setIndex(current => (current + 1) % count),
      1100,
    );
    return () => clearInterval(timer);
  }, [focused, count]);

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
      <Text style={styles.text}>
        {share.email
          ? 'Share your public keys, name, and email address.'
          : 'Share your public keys and name.'}{' '}
        On the other device, open Contacts, tap +, and choose Scan contact QR.
        Hold this screen steady while the codes cycle.
      </Text>
      <View style={styles.code}>
        <Svg
          accessible
          accessibilityLabel="Public identity QR code"
          width={size}
          height={size}
          viewBox={`0 0 ${image.size} ${image.size}`}>
          <Rect width={image.size} height={image.size} fill="#fff" />
          <Path d={image.path} fill="#000" />
        </Svg>
        <Text style={styles.text}>{`Code ${index + 1} of ${count}`}</Text>
      </View>
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
