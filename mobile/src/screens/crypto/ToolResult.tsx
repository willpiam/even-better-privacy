import React, {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import AppButton from '../../components/AppButton';
import AppIcon from '../../components/AppIcon';
import Card from '../../components/Card';
import StatusBanner from '../../components/StatusBanner';
import {usePlaceTheme} from '../../theme/PlaceTheme';
import {colors, radius, spacing, typography} from '../../theme/tokens';
import {ToolDisclosure, ToolHint} from './ToolForm';
import {shareToolFile} from './toolFiles';

export function ToolResult({
  title,
  tone = 'success',
  testID,
  children,
}: {
  title: string;
  tone?: 'success' | 'error';
  testID?: string;
  children?: React.ReactNode;
}) {
  const isError = tone === 'error';
  const color = isError ? colors.danger : colors.success;
  return (
    <Card style={styles.card}>
      <View
        style={[
          styles.header,
          {backgroundColor: isError ? colors.dangerSoft : colors.successSoft},
        ]}>
        <AppIcon name={isError ? 'info' : 'verify'} color={color} size={19} />
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          testID={testID}
          style={[styles.title, {color}]}>
          {title}
        </Text>
      </View>
      {children ? <View style={styles.content}>{children}</View> : null}
    </Card>
  );
}

export function ToolCopy({
  value,
  title = 'Copy',
  testID,
  inline = false,
}: {
  value: string;
  title?: string;
  testID?: string;
  inline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <AppButton
      title={copied ? 'Copied' : title}
      testID={testID}
      variant="secondary"
      style={inline ? styles.action : undefined}
      onPress={() => {
        Clipboard.setString(value);
        setCopied(true);
      }}
    />
  );
}

export function ToolShare({
  title,
  share,
  inline = false,
}: {
  title: string;
  share: () => Promise<unknown>;
  inline?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const onShare = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await share();
    } catch {
      setError('Could not open the share sheet. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={inline ? styles.action : styles.share}>
      <AppButton
        title={title}
        variant="secondary"
        loading={busy}
        onPress={onShare}
      />
      {error ? <StatusBanner kind="error" message={error} /> : null}
    </View>
  );
}

export function ToolPayloadResult({
  title,
  description,
  value,
  documentName,
  testID,
}: {
  title: string;
  description: string;
  value: string;
  documentName?: string;
  testID?: string;
}) {
  const previewLimit = 1800;
  const preview =
    value.length > previewLimit ? value.slice(0, previewLimit) + '…' : value;
  // Large payloads can exceed Android's clipboard and share intent size limits.
  const canCopy = value.length <= 100_000;
  const shareName = documentName ?? (canCopy ? undefined : 'payload.ebp.json');

  return (
    <ToolResult title={title}>
      <ToolHint>{description}</ToolHint>
      <View style={styles.actions}>
        {canCopy ? (
          <ToolCopy
            inline
            value={value}
            title="Copy payload"
            testID={testID ? `${testID}-copy` : undefined}
          />
        ) : null}
        <ToolShare
          inline
          title={shareName ? 'Share JSON file' : 'Share payload'}
          share={() =>
            shareName
              ? shareToolFile(shareName, value, 'application/json', 'utf8')
              : Share.open({message: value, failOnCancel: false})
          }
        />
      </View>
      <ToolDisclosure label="Preview payload">
        <Text testID={testID} style={styles.preview} selectable>
          {preview}
        </Text>
      </ToolDisclosure>
    </ToolResult>
  );
}

export function ToolSignatureStatus({
  status,
  fingerprint,
  knownContact,
}: {
  status: 'unsigned' | 'valid' | 'invalid';
  fingerprint?: string | null;
  knownContact?: boolean;
}) {
  const {accent, pale} = usePlaceTheme();
  const appearance = {
    unsigned: {color: accent, backgroundColor: pale, label: 'Unsigned'},
    valid: {
      color: colors.success,
      backgroundColor: colors.successSoft,
      label: 'Valid signature',
    },
    invalid: {
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
      label: 'Invalid signature',
    },
  }[status];

  return (
    <View
      style={[styles.signature, {backgroundColor: appearance.backgroundColor}]}>
      <Text style={[styles.label, {color: appearance.color}]}>
        {appearance.label}
      </Text>
      {status === 'valid' && knownContact === false ? (
        <ToolHint>
          Compare the signer fingerprint with the sender before trusting this
          message.
        </ToolHint>
      ) : null}
      {fingerprint ? (
        <Text style={styles.preview} selectable>
          {fingerprint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {marginTop: spacing.xs},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {flex: 1, fontSize: typography.row, fontWeight: '700'},
  content: {padding: spacing.md, gap: spacing.md},
  actions: {flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start'},
  action: {flex: 1, gap: spacing.sm},
  share: {gap: spacing.sm},
  preview: {color: colors.text, fontSize: typography.caption, lineHeight: 20},
  signature: {padding: spacing.md, gap: spacing.xs, borderRadius: radius.sm},
  label: {fontSize: typography.caption, fontWeight: '700'},
});

export const toolResultStyles = StyleSheet.create({
  text: {color: colors.text, fontSize: typography.body, lineHeight: 22},
});
