import React, {useState} from 'react';
import {Alert} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {runCoreSelfTest} from '../services/developerChecks';
import SectionTitle from './SectionTitle';
import ListRow from './ListRow';
import ListSection from './ListSection';
import StatusBanner from './StatusBanner';
import BusyOverlay from './BusyOverlay';
import {statusKind} from '../theme/statusKind';

type Props = Pick<
  NativeStackScreenProps<MoreStackParamList, 'MoreHome'>,
  'navigation'
>;

/** Loaded only in development builds by MoreScreen. */
export default function DeveloperTools({navigation}: Props): React.JSX.Element {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const onSelfTest = async () => {
    setBusy(true);
    setStatus('');
    try {
      setStatus(await runCoreSelfTest());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BusyOverlay visible={busy} message="Running core self-test…" />
      <StatusBanner message={status} kind={statusKind(status)} />
      <SectionTitle>Developer</SectionTitle>
      <ListSection>
        <ListRow
          testID="more-self-test"
          title="Core self-test"
          subtitle="Run crypto parity checks"
          onPress={() => {
            Alert.alert(
              'Core self-test',
              'Run the built-in crypto self-test?',
              [
                {text: 'Cancel', style: 'cancel'},
                {text: 'Run', onPress: () => void onSelfTest()},
              ],
            );
          }}
        />
        <ListRow
          testID="more-mail-trace"
          title="Mail trace"
          subtitle="Record a protocol trace for this session"
          onPress={() => navigation.navigate('MailTrace')}
        />
        <ListRow
          testID="more-diagnostics"
          title="Diagnostics"
          subtitle="Parity checks, paths"
          onPress={() => navigation.navigate('Diagnostics')}
          showDivider={false}
        />
      </ListSection>
    </>
  );
}
