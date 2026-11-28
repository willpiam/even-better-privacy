import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {
  ContactQrScanner,
  contactQrNameLimit,
  type ScannedContact,
} from '../services/contactQr';
import {contactNfc, decodeNfcContact} from '../services/contactNfc';
import {importScannedContact} from '../services/contacts';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import Screen from '../components/Screen';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import TextField from '../components/TextField';
import {colors, radius, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactQrScan'>;

export default function ContactQrScanScreen({navigation, route}: Props) {
  const viaNfc = route.params?.transport === 'nfc';
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const device = useCameraDevice('back');
  const [hasPermission, setHasPermission] = useState(
    () => Camera.getCameraPermissionStatus() === 'granted',
  );
  const scanner = useRef(new ContactQrScanner());
  const scanComplete = useRef(false);
  const saving = useRef(false);
  const [progress, setProgress] = useState<{received: number; total: number}>();
  const [contact, setContact] = useState<ScannedContact>();
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nfcAttempt, setNfcAttempt] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'active' && !viaNfc) {
        setHasPermission(Camera.getCameraPermissionStatus() === 'granted');
      }
    });
    return () => subscription.remove();
  }, [viaNfc]);

  const scanTitle = viaNfc ? 'Receive via NFC' : 'Scan contact QR';
  useEffect(() => {
    navigation.setOptions({
      title: contact ? 'Verify contact details' : scanTitle,
    });
  }, [contact, navigation, scanTitle]);

  const showContact = useCallback((received: ScannedContact) => {
    scanComplete.current = true;
    setAlias(received.name);
    setContact(received);
  }, []);

  useEffect(() => {
    if (!viaNfc || !focused || !foreground || contact) return;
    if (!contactNfc) {
      setError('NFC contact receiving is unavailable on this phone.');
      return;
    }
    let active = true;
    setError('');
    contactNfc
      .receive()
      .then(payload => {
        if (active) showContact(decodeNfcContact(payload));
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error ? e.message : 'Could not receive this contact.',
          );
        }
      });
    return () => {
      active = false;
      contactNfc.cancelReceive();
    };
  }, [viaNfc, focused, foreground, contact, nfcAttempt, showContact]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (viaNfc || scanComplete.current || !foreground || !focused) return;
      for (const {value} of codes) {
        if (!value) continue;
        try {
          const result = scanner.current.add(value);
          const {received, total} = result;
          setProgress(previous =>
            previous?.received === received && previous.total === total
              ? previous
              : {received, total},
          );
          setError('');
          if (result.contact) {
            showContact(result.contact);
            break;
          }
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : 'Could not read this contact code.',
          );
        }
      }
    },
  });

  const restart = useCallback(() => {
    scanner.current = new ContactQrScanner();
    scanComplete.current = false;
    setProgress(undefined);
    setContact(undefined);
    setError('');
    if (viaNfc) setNfcAttempt(attempt => attempt + 1);
  }, [viaNfc]);

  const addContact = async () => {
    if (!contact || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const name = await importScannedContact(
        contact.identity,
        alias.trim(),
        contact.email,
      );
      if (navigation.isFocused()) navigation.replace('ContactDetail', {name});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this contact.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (contact) {
    const {identity, email} = contact;
    return (
      <Screen scroll>
        <Text style={styles.text}>
          {email
            ? 'Compare the full fingerprint and email address with the person sharing their contact before you add it.'
            : 'Compare the full fingerprint with the person sharing their contact before you add it.'}
        </Text>
        <Card padded style={styles.details}>
          <SectionTitle>Full fingerprint</SectionTitle>
          <Text
            selectable
            style={styles.fingerprint}
            testID="scanned-contact-fingerprint">
            {identity.fingerprint}
          </Text>
          <Text style={styles.text}>
            {identity.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA'}{' '}
            signing · ML-KEM encryption
          </Text>
        </Card>
        {email ? (
          <Card padded style={styles.details}>
            <SectionTitle>Email address</SectionTitle>
            <Text selectable style={styles.text}>
              {email}
            </Text>
          </Card>
        ) : null}
        <TextField
          label="Contact name"
          placeholder="Optional"
          value={alias}
          onChangeText={setAlias}
          maxLength={contactQrNameLimit}
          editable={!busy}
        />
        <StatusBanner message={error} kind="error" />
        <AppButton
          title="Add contact"
          loading={busy}
          testID="add-scanned-contact"
          onPress={addContact}
        />
        <AppButton
          title={viaNfc ? 'Receive again' : 'Scan again'}
          variant="secondary"
          disabled={busy}
          onPress={restart}
        />
      </Screen>
    );
  }

  if (viaNfc) {
    return (
      <Screen>
        <Text style={styles.text}>
          Ask the other person to tap Share via NFC in EBP, then hold the backs
          of your phones together until their contact details appear.
        </Text>
        <StatusBanner message={error} kind="error" />
        {error && contactNfc ? (
          <AppButton title="Try again" variant="secondary" onPress={restart} />
        ) : null}
      </Screen>
    );
  }

  if (!hasPermission) {
    const enableCamera = async () => {
      setError('');
      try {
        if (Platform.OS === 'android') {
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
          );
          setHasPermission(result === PermissionsAndroid.RESULTS.GRANTED);
          if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
            await Linking.openSettings();
          } else if (result === PermissionsAndroid.RESULTS.DENIED) {
            setError('Camera access is required to scan contact codes.');
          }
        } else if (Camera.getCameraPermissionStatus() === 'not-determined') {
          setHasPermission(
            (await Camera.requestCameraPermission()) === 'granted',
          );
        } else {
          await Linking.openSettings();
        }
      } catch {
        setError('Could not enable camera access.');
      }
    };
    return (
      <Screen>
        <Text style={styles.text}>
          Allow camera access to scan a contact QR code.
        </Text>
        <StatusBanner message={error} kind="error" />
        <AppButton title="Enable camera" onPress={enableCamera} />
      </Screen>
    );
  }

  if (!device) {
    return (
      <Screen>
        <StatusBanner
          message="No rear camera is available on this device."
          kind="error"
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.text}>
        Point the camera at the contact QR code. Keep it in view while the codes
        cycle.
      </Text>
      <View style={styles.preview}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={focused && foreground}
          codeScanner={codeScanner}
          onError={() =>
            setError('The camera could not start. Go back and try again.')
          }
        />
      </View>
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {progress
          ? `${progress.received} of ${progress.total} codes scanned`
          : 'Waiting for a contact code…'}
      </Text>
      <StatusBanner message={error} kind="error" />
      {progress || error ? (
        <AppButton title="Restart scan" variant="secondary" onPress={restart} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  details: {gap: spacing.sm},
  text: {color: colors.muted, fontSize: typography.body},
  fingerprint: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.body,
  },
});
