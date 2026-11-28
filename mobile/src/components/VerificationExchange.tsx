import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import {contactNfc} from '../services/contactNfc';
import {
  decodeNfcVerification,
  VerificationScanner,
  type VerificationPart,
} from '../services/verificationTransfer';
import {colors, layout, typography} from '../theme/tokens';
import AppButton from './AppButton';
import QrCode, {qrImage} from './QrCode';
import StatusBanner from './StatusBanner';

export type ExchangeMode =
  | {mode: 'show' | 'share'; part: VerificationPart; frames: string[]}
  | {mode: 'scan' | 'receive'; part: VerificationPart};

export default function VerificationExchange({
  exchange,
  onRead,
  onClose,
}: {
  exchange: ExchangeMode;
  onRead: (part: VerificationPart, data: string) => void;
  onClose: () => void;
}) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const complete = useRef(false);
  const read = useRef(onRead);
  read.current = onRead;

  const receive = useCallback((part: VerificationPart, data: string) => {
    if (complete.current) return;
    read.current(part, data);
    complete.current = true;
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!foreground || !focused || !contactNfc) return;
    const nfc = contactNfc;
    if (exchange.mode !== 'share' && exchange.mode !== 'receive') return;
    let active = true;
    const task =
      exchange.mode === 'share'
        ? nfc.startSharing(exchange.frames.join('\n'))
        : nfc.receive().then(payload => {
            if (active)
              receive(
                exchange.part,
                decodeNfcVerification(exchange.part, payload),
              );
          });
    task.catch(cause => {
      if (active)
        setError(
          cause instanceof Error ? cause.message : 'NFC exchange failed.',
        );
    });
    return () => {
      active = false;
      if (exchange.mode === 'share') nfc.stopSharing();
      else nfc.cancelReceive();
    };
  }, [attempt, exchange, focused, foreground, receive]);

  return (
    <>
      {exchange.mode === 'show' ? (
        <VerificationQr
          frames={exchange.frames}
          active={focused && foreground}
        />
      ) : exchange.mode === 'scan' ? (
        <VerificationCamera
          part={exchange.part}
          active={focused && foreground}
          onRead={receive}
        />
      ) : (
        <Text style={styles.text}>
          {exchange.mode === 'share'
            ? `Ask the other person to receive your ${exchange.part} via NFC. `
            : `Ask the other person to share their ${exchange.part} via NFC. `}
          Hold the backs of the phones together until the receiving phone
          confirms.
        </Text>
      )}
      <StatusBanner kind="error" message={error} />
      {error ? (
        <AppButton
          title="Retry NFC"
          variant="secondary"
          onPress={() => {
            setError('');
            setAttempt(current => current + 1);
          }}
        />
      ) : null}
      <AppButton
        title="Back to exchange"
        variant="secondary"
        onPress={onClose}
      />
    </>
  );
}

function VerificationQr({frames, active}: {frames: string[]; active: boolean}) {
  const [index, setIndex] = useState(0);
  const {width, height} = useWindowDimensions();
  const count = frames.length;

  useEffect(() => {
    if (!active || count < 2) return;
    const timer = setInterval(
      () => setIndex(current => (current + 1) % count),
      850,
    );
    return () => clearInterval(timer);
  }, [active, count]);

  const image = React.useMemo(() => qrImage(frames[index]), [frames, index]);
  return (
    <View style={styles.code}>
      <QrCode
        image={image}
        size={Math.min(width - layout.gutter * 2, height * 0.65, 480)}
        label="Verification QR code"
      />
      <Text style={styles.text}>{`Code ${index + 1} of ${count}`}</Text>
    </View>
  );
}

function VerificationCamera({
  part,
  active,
  onRead,
}: {
  part: VerificationPart;
  active: boolean;
  onRead: (part: VerificationPart, data: string) => void;
}) {
  const scanner = useRef(new VerificationScanner(part));
  const [progress, setProgress] = useState({received: 0, total: 0});
  const [hasPermission, setHasPermission] = useState(
    () => Camera.getCameraPermissionStatus() === 'granted',
  );
  const [error, setError] = useState('');
  const device = useCameraDevice('back');

  useEffect(() => {
    if (active)
      setHasPermission(Camera.getCameraPermissionStatus() === 'granted');
  }, [active]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: results => {
      if (!active) return;
      for (const {value} of results) {
        if (!value) continue;
        try {
          const {received, total, data} = scanner.current.add(value);
          setProgress(previous =>
            previous.received === received ? previous : {received, total},
          );
          setError('');
          if (data) {
            onRead(part, data);
            break;
          }
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not read this code.',
          );
        }
      }
    },
  });

  const enableCamera = async () => {
    try {
      setError('');
      if (Platform.OS === 'android') {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        setHasPermission(result === PermissionsAndroid.RESULTS.GRANTED);
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
          await Linking.openSettings();
        if (result === PermissionsAndroid.RESULTS.DENIED)
          setError('Camera access is required to scan QR codes.');
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
    <>
      {!hasPermission ? (
        <AppButton title="Enable camera" onPress={enableCamera} />
      ) : device ? (
        <>
          <View style={styles.preview}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={active}
              codeScanner={codeScanner}
              onError={() =>
                setError('The camera could not start. Reopen the scanner.')
              }
            />
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {progress.total
              ? `${progress.received} of ${progress.total} codes scanned`
              : 'Keep the other phone’s screen in view while the codes cycle.'}
          </Text>
        </>
      ) : (
        <StatusBanner kind="error" message="No rear camera is available." />
      )}
      <StatusBanner message={error} kind="error" />
    </>
  );
}

const styles = StyleSheet.create({
  code: {alignItems: 'center'},
  preview: {height: 280, overflow: 'hidden', backgroundColor: '#000'},
  text: {color: colors.muted, fontSize: typography.body},
});
