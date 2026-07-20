import React, {useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {runCoreSelfTest} from '../services/storage';
import Screen from '../components/Screen';
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

  React.useEffect(() => {
    void getServerUrl().then(setServerUrl);
  }, []);

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
      <StatusBanner message={status} kind={statusKind(status)} />
      <SectionTitle>Settings</SectionTitle>
      <Card>
        <ListRow
          title="Server URL"
          subtitle={serverUrl || 'Not set'}
          onPress={() => navigation.navigate('Settings')}
        />
        <ListRow
          title="Password policy"
          subtitle="Open Settings"
          onPress={() => navigation.navigate('Settings')}
        />
        <ListRow
          title="Mail preferences"
          subtitle="PIN, OAuth overrides"
          onPress={() => navigation.navigate('Settings')}
        />
      </Card>
      <SectionTitle>App</SectionTitle>
      <Card>
        <ListRow
          title="Certificates"
          subtitle="Hierarchy tree"
          onPress={() => navigation.navigate('Certificates')}
        />
        <ListRow
          title="Project info"
          subtitle="About EBP"
          onPress={() => navigation.navigate('ProjectInfo')}
        />
        <ListRow
          title="Activity log"
          subtitle="Recent operations"
          onPress={() => navigation.navigate('Settings')}
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
      </Card>
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: {height: 24},
});
