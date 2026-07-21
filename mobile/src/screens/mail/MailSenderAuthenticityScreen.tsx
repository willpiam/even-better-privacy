import React from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import SectionTitle from '../../components/SectionTitle';
import {colors, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailSenderAuthenticity'>;

function Row({label, value}: {label: string; value: string}): JSX.Element {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </>
  );
}

export default function MailSenderAuthenticityScreen({
  route,
}: Props): JSX.Element {
  const s = route.params.summary;

  const signatureText =
    s.verifyStatus === 'unsigned'
      ? 'This message was encrypted but not signed.'
      : s.verifyStatus === 'invalid'
        ? 'The signature is invalid.'
        : s.verifyStatus === 'valid_unbound'
          ? 'Signature is valid but not bound to the recipient (legacy).'
          : s.verifyStatus === 'valid_unknown_signer'
            ? 'Signature is valid. Signer is not in your local contacts.'
            : 'Signature is valid.';

  const fromText =
    s.signerMatchesSenderEmail === true
      ? `Message From matches the signer’s ${s.matchedEmailPath ?? 'email'} claim.`
      : s.signerMatchesSenderEmail === false
        ? 'Message From does not match any email claim on the signer’s identity.'
        : 'No email claim on the signer’s identity to compare with From.';

  const endorseText =
    s.signerEmailVerified === true
      ? `The matched ${s.matchedEmailPath ?? 'email'} detail has a verify-email endorsement.`
      : s.signerEmailVerified === false
        ? 'An email claim exists but is not endorsed via verify-email.'
        : 'No email endorsement applies.';

  return (
    <Screen scroll>
      <SectionTitle>Who signed</SectionTitle>
      <Card padded>
        <Row
          label="Contact"
          value={s.contactName ?? (s.isKnownContact ? 'Local contact' : 'Unknown contact')}
        />
        <Row
          label="Fingerprint"
          value={s.signerFingerprint ?? '(none)'}
        />
        <Row
          label="Known contact"
          value={s.isKnownContact ? 'Yes' : 'No'}
        />
        {s.serverIdentityMatch !== null ? (
          <Row
            label="Matches server identity"
            value={s.serverIdentityMatch ? 'Yes' : 'No'}
          />
        ) : null}
      </Card>

      <SectionTitle>Email claims</SectionTitle>
      <Card padded>
        <Row label="Message From" value={s.messageFrom || '(missing)'} />
        <Row
          label="Published email"
          value={s.signerEmail ?? '(none)'}
        />
        <Row
          label="Matched path"
          value={s.matchedEmailPath ?? '(none)'}
        />
        <Row
          label="Opaque email match"
          value={s.opaqueEmailMatched ? 'Yes' : 'No'}
        />
        <Text style={styles.plain}>{fromText}</Text>
      </Card>

      <SectionTitle>Endorsement</SectionTitle>
      <Card padded>
        <Row
          label="Verified"
          value={
            s.signerEmailVerified === true
              ? 'Yes'
              : s.signerEmailVerified === false
                ? 'No'
                : 'N/A'
          }
        />
        <Text style={styles.plain}>{endorseText}</Text>
      </Card>

      <SectionTitle>Signature</SectionTitle>
      <Card padded>
        <Row label="Status" value={s.verifyStatus} />
        <Text style={styles.plain}>{signatureText}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  value: {
    fontSize: typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  plain: {
    marginTop: spacing.md,
    fontSize: typography.body,
    color: colors.text,
    lineHeight: 20,
  },
});
