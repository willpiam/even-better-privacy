import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {runCoreSelfTest} from '../services/storage';
import Screen from '../components/Screen';
import BrandHeader from '../components/BrandHeader';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import Card from '../components/Card';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import {statusKind} from '../theme/statusKind';
import {getServerUrl} from '../services/settings';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>;

export default function MoreScreen({navigation}: Props): JSX.Element {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  useFocusEffect(
    useCallback(() => {
      void getServerUrl().then(setServerUrl);
    }, []),
  );

  const onSelfTest = async () => {
    setBusy(true);
    setStatus('');
    try {
      const result = await runCoreSelfTest();
      setStatus(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <BusyOverlay visible={busy} message="Running core self-test…" />
      <BrandHeader />
      <StatusBanner message={status} kind={statusKind(status)} />
      <SectionTitle>Preferences</SectionTitle>
      <Card>
        <ListRow
          testID="more-settings"
          title="Settings"
          subtitle={serverUrl || 'Server, password policy, mail'}
          onPress={() => navigation.navigate('Settings')}
        />
        <ListRow
          testID="more-activity-log"
          title="Activity log"
          subtitle="Recent operations"
          onPress={() => navigation.navigate('ActivityLog')}
          showDivider={false}
        />
      </Card>
      <SectionTitle>App</SectionTitle>
      <Card>
        <ListRow
          testID="more-certificates"
          title="Certificates"
          subtitle="Hierarchy tree"
          onPress={() => navigation.navigate('Certificates')}
        />
        <ListRow
          testID="more-about"
          title="About EBP"
          subtitle="Project info"
          onPress={() => navigation.navigate('ProjectInfo')}
          showDivider={false}
        />
      </Card>
      <SectionTitle>Developer</SectionTitle>
      <Card>
        <ListRow
          title="Core self-test"
          subtitle="Run crypto parity checks"
          onPress={() => {
            Alert.alert('Core self-test', 'Run the built-in crypto self-test?', [
              {text: 'Cancel', style: 'cancel'},
              {text: 'Run', onPress: () => void onSelfTest()},
            ]);
          }}
        />
        <ListRow
          title="Mail trace"
          subtitle="Protocol stubs"
          onPress={() => navigation.navigate('MailTrace')}
        />
        <ListRow
          title="Diagnostics"
          subtitle="Parity checks, paths"
          onPress={() => navigation.navigate('Diagnostics')}
          showDivider={false}
        />
      </Card>
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: {height: 24},
});
