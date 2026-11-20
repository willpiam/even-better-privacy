import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, Switch, Text, type SwitchProps} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {
  AUTO_LOCK_MINUTE_OPTIONS,
  getAutoLockMinutes,
  getEnforcePasswordPolicy,
  getMailIncludePublicKeys,
  getMailTestMode,
  getMailRenderHtml,
  getServerUrl,
  setAutoLockMinutes,
  setEnforcePasswordPolicy,
  setMailIncludePublicKeys,
  setMailTestMode,
  setMailRenderHtml,
  setServerUrl,
} from '../services/settings';
import {
  applyUnlockTimeoutMinutes,
  installIdentityUnlockWatcher,
  lockAll,
} from '../services/unlockSession';
import Screen from '../components/Screen';
import ListRow from '../components/ListRow';
import ListSection from '../components/ListSection';
import {usePlaceTheme} from '../theme/PlaceTheme';
import SegmentedControl from '../components/SegmentedControl';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Settings'>;

export default function SettingsScreen({navigation}: Props): JSX.Element {
  const [serverUrl, setServerUrlValue] = useState('');
  const [enforcePasswordPolicy, setEnforcePasswordPolicyValue] = useState(true);
  const [autoLockMinutes, setAutoLockMinutesValue] = useState(15);
  const [mailRenderHtml, setMailRenderHtmlValue] = useState(false);
  const [mailIncludePublicKeys, setMailIncludePublicKeysValue] = useState(true);
  const [mailTestMode, setMailTestModeValue] = useState(false);
  const [savingTestMode, setSavingTestMode] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      installIdentityUnlockWatcher();
      void (async () => {
        const [url, enforce, lockMinutes, renderHtml, includeKeys, testMode] =
          await Promise.all([
            getServerUrl(),
            getEnforcePasswordPolicy(),
            getAutoLockMinutes(),
            getMailRenderHtml(),
            getMailIncludePublicKeys(),
            getMailTestMode(),
          ]);
        setServerUrlValue(url);
        setEnforcePasswordPolicyValue(enforce);
        setAutoLockMinutesValue(lockMinutes);
        setMailRenderHtmlValue(renderHtml);
        setMailIncludePublicKeysValue(includeKeys);
        setMailTestModeValue(testMode);
      })();
    }, []),
  );

  const onSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      await setServerUrl(serverUrl);
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveTestMode = async (value: boolean) => {
    setSavingTestMode(true);
    try {
      await setMailTestMode(value);
      setMailTestModeValue(value);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTestMode(false);
    }
  };

  const onTestModeChange = (value: boolean) => {
    if (!value) {
      void saveTestMode(false);
      return;
    }
    Alert.alert(
      'Enable test emails and payments?',
      'test.pqpost.com is for testing only. Short test addresses use Ethereum Sepolia or Cardano preview test funds. Never send real cryptocurrency or mainnet funds to a testnet payment address: you could lose them. Test payments do not buy a pqpost.com address.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'I understand, enable',
          onPress: () => void saveTestMode(true),
        },
      ],
      {cancelable: true},
    );
  };

  return (
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Key Server</SectionTitle>
      <TextField
        label="Server URL"
        testID="settings-server-url"
        keyboardType="url"
        spellCheck={false}
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
      <ListSection>
        <SettingsSwitch
          label="Enforce password policy"
          showDivider={false}
          testID="settings-enforce-password-policy"
          value={enforcePasswordPolicy}
          onValueChange={async value => {
            setEnforcePasswordPolicyValue(value);
            await setEnforcePasswordPolicy(value);
          }}
        />
      </ListSection>
      <Text style={styles.fieldLabel}>Auto-lock after</Text>
      <SegmentedControl
        testID="settings-auto-lock"
        options={AUTO_LOCK_MINUTE_OPTIONS.map(minutes => ({
          label: `${minutes} min`,
          value: String(minutes),
        }))}
        value={String(autoLockMinutes)}
        onChange={value => {
          const minutes = Number(value);
          setAutoLockMinutesValue(minutes);
          void setAutoLockMinutes(minutes);
          applyUnlockTimeoutMinutes(minutes);
        }}
      />
      <AppButton
        title="Lock now"
        testID="settings-lock-now"
        variant="secondary"
        onPress={() => {
          lockAll();
          setStatus('Identity locked');
        }}
      />

      <SectionTitle>Test mail</SectionTitle>
      <ListSection>
        <SettingsSwitch
          label="Enable test emails and payments"
          showDivider={false}
          testID="settings-mail-test-mode"
          value={mailTestMode}
          disabled={savingTestMode}
          onValueChange={onTestModeChange}
        />
      </ListSection>
      <Text style={styles.advancedNote}>
        Adds a choice of test.pqpost.com or pqpost.com when creating an EBP
        email. Only short test names require payment, using test funds only.
      </Text>

      <SectionTitle>Mail preferences</SectionTitle>
      <AppButton
        title="Mail accounts"
        variant="secondary"
        onPress={() => navigation.navigate('MailAccountSettings')}
      />
      <ListSection>
        <SettingsSwitch
          label="Render HTML mail bodies"
          testID="settings-mail-render-html"
          value={mailRenderHtml}
          onValueChange={async value => {
            setMailRenderHtmlValue(value);
            await setMailRenderHtml(value);
          }}
        />
        <SettingsSwitch
          label="Include public keys in EBP mail"
          showDivider={false}
          testID="settings-mail-include-public-keys"
          value={mailIncludePublicKeys}
          onValueChange={async value => {
            setMailIncludePublicKeysValue(value);
            await setMailIncludePublicKeys(value);
          }}
        />
      </ListSection>
    </Screen>
  );
}

function SettingsSwitch({
  label,
  showDivider,
  ...props
}: SwitchProps & {label: string; showDivider?: boolean}) {
  const {accent} = usePlaceTheme();
  return (
    <ListRow
      title={label}
      showDivider={showDivider}
      right={
        <Switch
          {...props}
          accessibilityLabel={label}
          trackColor={{false: colors.fieldBorder, true: accent}}
          ios_backgroundColor={colors.fieldBorder}
          thumbColor={colors.surface}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  advancedNote: {
    fontSize: 13,
    color: colors.muted,
  },
  fieldLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.muted,
  },
});
