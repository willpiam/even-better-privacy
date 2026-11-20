import React, {useCallback, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import AppButton from '../../components/AppButton';
import ListRow from '../../components/ListRow';
import ListSection from '../../components/ListSection';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import StatusBanner from '../../components/StatusBanner';
import type {MoreStackParamList} from '../../navigation/AppNavigator';
import {
  readMailStore,
  resolveSelectedAccountId,
  selectMailAccount,
} from '../../services/mail/accountStore';
import type {MailAccountStore} from '../../services/mail/types';
import {getCurrentIdentityRequired} from '../../services/storage';
import {colors, layout, spacing} from '../../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'MailAccountSettings'>;

export default function MailAccountSettingsScreen({
  navigation,
}: Props): React.JSX.Element {
  const [mail, setMail] = useState<{
    identityName: string;
    store: MailAccountStore;
  }>();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      setMail(undefined);
      setError('');
      void (async () => {
        try {
          const identityName = await getCurrentIdentityRequired();
          const store = await readMailStore(identityName);
          if (focused) setMail({identityName, store});
        } catch (cause) {
          if (focused)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
      return () => {
        focused = false;
      };
    }, []),
  );

  const selectAccount = async (accountId: string) => {
    if (!mail) return;
    setSelecting(true);
    setError('');
    try {
      await selectMailAccount(mail.identityName, accountId);
      const store = await readMailStore(mail.identityName);
      setMail(current => (current === mail ? {...mail, store} : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelecting(false);
    }
  };

  const selectedId = mail ? resolveSelectedAccountId(mail.store) : null;
  const multipleAccounts = (mail?.store.accounts.length ?? 0) > 1;

  return (
    <Screen scroll>
      {mail ? <SectionTitle>{mail.identityName}</SectionTitle> : null}
      <StatusBanner message={error} kind="error" />
      {mail?.store.accounts.length ? (
        <ListSection>
          {mail.store.accounts.map((account, index) => {
            const selected = account.id === selectedId;
            return (
              <View key={account.id} style={styles.account}>
                <ListRow
                  title={account.name}
                  subtitle={account.config.fromEmail || account.config.username}
                  badge={multipleAccounts && selected ? 'Selected' : undefined}
                  avatarText={account.name}
                  showDivider={false}
                  onPress={() =>
                    navigation.navigate('MailAccountSetup', {
                      accountId: account.id,
                    })
                  }
                />
                {selected ? null : (
                  <View style={styles.action}>
                    <AppButton
                      title={`Select ${account.name}`}
                      variant="secondary"
                      disabled={selecting}
                      onPress={() => void selectAccount(account.id)}
                    />
                  </View>
                )}
                {index < mail.store.accounts.length - 1 ? (
                  <View style={styles.divider} />
                ) : null}
              </View>
            );
          })}
        </ListSection>
      ) : null}
      <AppButton
        title="Add account"
        variant="secondary"
        onPress={() => navigation.navigate('MailAccountSetup', {})}
      />
      <AppButton
        title="Create an EBP email address"
        variant="secondary"
        onPress={() => navigation.navigate('OnboardingWizard')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: {backgroundColor: colors.surface},
  action: {paddingHorizontal: layout.gutter, paddingBottom: spacing.md},
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginHorizontal: layout.gutter,
  },
});
