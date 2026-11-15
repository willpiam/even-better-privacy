import React from 'react';
import {StyleSheet, Text} from 'react-native';
import type {IdentityPublication} from '../services/identityPublication';
import {colors} from '../theme/tokens';

export default function IdentityPublicationStatus({
  publication,
  locallyRevoked = false,
}: {
  publication: IdentityPublication;
  locallyRevoked?: boolean;
}) {
  if (locallyRevoked) {
    return (
      <Text style={styles.revoked} testID="identity-revoked">
        Identity revoked on this device
      </Text>
    );
  }
  if (publication.state === 'published') {
    return (
      <Text style={styles.success} testID="identity-published">
        ✓ Published
      </Text>
    );
  }
  if (publication.state === 'revoked') {
    return (
      <Text style={styles.revoked} testID="identity-revoked">
        Identity revoked
      </Text>
    );
  }
  return (
    <Text style={styles.hint} testID="identity-publication-status">
      {publication.state === 'checking'
        ? 'Checking server status…'
        : publication.state === 'unpublished'
        ? 'Not published on this server'
        : 'Publication status unavailable'}
    </Text>
  );
}

const styles = StyleSheet.create({
  success: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  revoked: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  hint: {color: colors.muted, fontSize: 13, marginTop: 8},
});
