import React, {useCallback, useState} from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {
  getEnforcePasswordPolicy,
  getMailIncludePublicKeys,
  getMailOauthGmailClientIdOverride,
  getMailOauthOutlookClientIdOverride,
  getMailRenderHtml,
  getServerUrl,
  setEnforcePasswordPolicy,
  setMailIncludePublicKeys,
  setMailOauthGmailClientIdOverride,
  setMailOauthOutlookClientIdOverride,
  setMailRenderHtml,
  setServerUrl,
} from '../services/settings';
import {appendActivityLog} from '../services/activityLog';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';
import {colors, spacing, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Settings'>;

export default function SettingsScreen(_props: Props): JSX.Element {
  const [serverUrl, setServerUrlValue] = useState('');
  const [enforcePasswordPolicy, setEnforcePasswordPolicyValue] = useState(true);
  const [mailRenderHtml, setMailRenderHtmlValue] = useState(false);
  const [mailIncludePublicKeys, setMailIncludePublicKeysValue] = useState(true);
  const [gmailOauthClientIdOverride, setGmailOauthClientIdOverride] = useState('');
  const [outlookOauthClientIdOverride, setOutlookOauthClientIdOverride] =
    useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [url, enforce, renderHtml, includeKeys, gmailOverride, outlookOverride] =
          await Promise.all([
            getServerUrl(),
            getEnforcePasswordPolicy(),
            getMailRenderHtml(),
            getMailIncludePublicKeys(),
            getMailOauthGmailClientIdOverride(),
            getMailOauthOutlookClientIdOverride(),
          ]);
        setServerUrlValue(url);
        setEnforcePasswordPolicyValue(enforce);
        setMailRenderHtmlValue(renderHtml);
        setMailIncludePublicKeysValue(includeKeys);
        setGmailOauthClientIdOverride(gmailOverride);
        setOutlookOauthClientIdOverride(outlookOverride);
      })();
    }, []),
  );

  const onSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      await setServerUrl(serverUrl);
      await setMailOauthGmailClientIdOverride(gmailOauthClientIdOverride);
      await setMailOauthOutlookClientIdOverride(outlookOauthClientIdOverride);
      await appendActivityLog('Settings saved', 'success');
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Key Server</SectionTitle>
      <TextField
        label="Server URL"
        testID="settings-server-url"
        autoCapitalize="none"
        autoCorrect={false}
        selectTextOnFocus
        value={serverUrl}
        onChangeText={setServerUrlValue}
      />
      <AppButton
        title={loading ? 'Saving…' : 'Save'}
        testID="settings-save"
        loading={loading}
        disabled={loading}
        onPress={onSave}
      />

      <SectionTitle>Identity</SectionTitle>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Enforce password policy</Text>
        <Switch
          testID="settings-enforce-password-policy"
          value={enforcePasswordPolicy}
          onValueChange={async value => {
            setEnforcePasswordPolicyValue(value);
            await setEnforcePasswordPolicy(value);
          }}
        />
      </View>

      <SectionTitle>Mail preferences</SectionTitle>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Render HTML mail bodies</Text>
        <Switch
          testID="settings-mail-render-html"
          value={mailRenderHtml}
          onValueChange={async value => {
            setMailRenderHtmlValue(value);
            await setMailRenderHtml(value);
          }}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Include public keys in EBP mail</Text>
        <Switch
          testID="settings-mail-include-public-keys"
          value={mailIncludePublicKeys}
          onValueChange={async value => {
            setMailIncludePublicKeysValue(value);
            await setMailIncludePublicKeys(value);
          }}
        />
      </View>

      <SectionTitle>Advanced</SectionTitle>
      <Text style={styles.advancedNote}>
        Mail OAuth client IDs are normally loaded from the key server. Override
        only for development.
      </Text>
      <TextField
        label="Gmail OAuth client ID override"
        autoCapitalize="none"
        autoCorrect={false}
        value={gmailOauthClientIdOverride}
        onChangeText={setGmailOauthClientIdOverride}
        placeholder="Optional"
      />
      <TextField
        label="Outlook OAuth client ID override"
        autoCapitalize="none"
        autoCorrect={false}
        value={outlookOauthClientIdOverride}
        onChangeText={setOutlookOauthClientIdOverride}
        placeholder="Optional"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  switchLabel: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
    marginRight: spacing.sm,
  },
  advancedNote: {
    fontSize: 13,
    color: colors.muted,
  },
});
