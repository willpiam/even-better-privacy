import React, {useEffect} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {IdentitiesStackParamList} from '../navigation/AppNavigator';
import {useIdentityProfile} from '../hooks/useIdentityProfile';
import {
  isEmailVerified,
  isDetailPublished,
} from '../services/identityPublication';
import Screen from '../components/Screen';
import Card from '../components/Card';
import ListRow from '../components/ListRow';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import AppButton from '../components/AppButton';
import IdentityPublicationStatus from '../components/IdentityPublicationStatus';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<IdentitiesStackParamList, 'IdentityDetail'>;

export default function IdentityDetailScreen({route, navigation}: Props) {
  const {identityName} = route.params;
  const {
    identity,
    loading,
    serverUrl,
    details,
    publication,
    locallyRevoked,
    error,
    refresh,
  } = useIdentityProfile(identityName);

  useEffect(() => {
    navigation.setOptions({title: identityName});
  }, [navigation, identityName]);

  if (!identity) {
    return (
      <Screen>
        <StatusBanner
          message={
            error || (loading ? 'Loading identity…' : 'Identity not found.')
          }
          kind={error || !loading ? 'error' : 'info'}
        />
      </Screen>
    );
  }

  const emails = details.filter(
    item => item.path === 'email' || item.path === 'opaque::email',
  );
  const params = {identityName};
  return (
    <Screen scroll>
      <Card padded>
        <Text style={styles.name} testID="identity-name">
          {identity.name}
        </Text>
        <Text style={styles.meta}>
          {identity.signingKeyType === 'sphincs' ? 'SLH-DSA' : 'ML-DSA'} ·{' '}
          {identity.encryptionKeyType}
        </Text>
        <Text
          style={styles.fingerprint}
          testID="identity-fingerprint"
          selectable>
          {identity.fingerprint}
        </Text>
        <Text style={styles.meta}>Server: {serverUrl || '—'}</Text>
        <IdentityPublicationStatus
          publication={publication}
          locallyRevoked={locallyRevoked}
        />
      </Card>
      <StatusBanner message={error} kind="error" />
      {publication.state === 'unavailable' ? (
        <>
          <Text style={styles.hint}>{publication.message}</Text>
          <AppButton
            title="Check status again"
            testID="identity-status-refresh"
            variant="secondary"
            onPress={() => {
              void refresh();
            }}
          />
        </>
      ) : null}
      {publication.state === 'unpublished' && !locallyRevoked ? (
        <Card>
          <ListRow
            title="Publish identity"
            icon="shield"
            subtitle="Make your public keys available on this server"
            testID="identity-open-publish"
            onPress={() => navigation.navigate('IdentityPublish', params)}
            showDivider={false}
          />
        </Card>
      ) : null}
      {emails.length > 0 ? <SectionTitle>Email</SectionTitle> : null}
      {emails.map(email => (
        <Card key={email.path} padded style={styles.emailCard}>
          <Text style={styles.email} selectable>
            {email.path === 'opaque::email'
              ? 'Private email (hashed)'
              : email.detail}
          </Text>
          {isEmailVerified(email, publication) ? (
            <Text
              style={styles.success}
              testID={`identity-email-verified-${email.path}`}>
              ✓ Email verified
            </Text>
          ) : publication.state === 'published' ? (
            <AppButton
              title={
                isDetailPublished(email, publication)
                  ? 'Verify email'
                  : 'Manage email'
              }
              testID={`identity-open-verify-${email.path}`}
              variant="secondary"
              onPress={() => navigation.navigate('IdentityDetails', params)}
            />
          ) : (
            <Text style={styles.hint}>
              {publication.state === 'unpublished'
                ? 'Publish this identity to verify its email.'
                : publication.state === 'revoked'
                ? 'This identity has been revoked.'
                : publication.state === 'checking'
                ? 'Checking email verification…'
                : 'Email verification status unavailable.'}
            </Text>
          )}
        </Card>
      ))}
      <SectionTitle>Manage identity</SectionTitle>
      <Card>
        <ListRow
          title="Identity details"
          icon="key"
          subtitle="View, add, and verify details"
          testID="identity-open-details"
          onPress={() => navigation.navigate('IdentityDetails', params)}
        />
        <ListRow
          title="Export and backup"
          icon="file"
          subtitle="Share public keys, save your identity, or create an emergency certificate"
          testID="identity-open-export"
          onPress={() => navigation.navigate('IdentityExport', params)}
        />
        <ListRow
          title="Revocation and removal"
          icon="lock"
          subtitle="Revoke details or identity, or remove it from this device"
          testID="identity-open-security"
          onPress={() => navigation.navigate('IdentitySecurity', params)}
          showDivider={false}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: {fontWeight: '700', fontSize: 18, color: colors.text, marginBottom: 6},
  meta: {fontSize: typography.caption, color: colors.muted, marginTop: 4},
  fingerprint: {
    marginTop: 8,
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  hint: {fontSize: 13, color: colors.muted, lineHeight: 18},
  emailCard: {gap: 8},
  email: {fontSize: typography.body, color: colors.text},
  success: {color: colors.success, fontSize: 13, fontWeight: '600'},
});
