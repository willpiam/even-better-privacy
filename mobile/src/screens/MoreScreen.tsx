import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import Screen from '../components/Screen';
import PlaceHeader from '../components/PlaceHeader';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import ListSection from '../components/ListSection';
import {getServerUrl} from '../services/settings';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>;

// Metro removes the require and its developer-only dependencies in releases.
const DeveloperTools = __DEV__
  ? require('../components/DeveloperTools').default
  : null;

export default function MoreScreen({navigation}: Props): JSX.Element {
  const [serverUrl, setServerUrl] = useState('');

  useFocusEffect(
    useCallback(() => {
      void getServerUrl().then(setServerUrl);
    }, []),
  );

  return (
    <Screen scroll>
      <PlaceHeader title="Your space" />
      <SectionTitle>Preferences</SectionTitle>
      <ListSection>
        <ListRow
          testID="more-settings"
          title="Settings"
          icon="settings"
          subtitle={serverUrl || 'Server, auto-lock, password policy, mail'}
          onPress={() => navigation.navigate('Settings')}
          showDivider={false}
        />
      </ListSection>
      <SectionTitle>App</SectionTitle>
      <ListSection>
        <ListRow
          testID="more-about"
          title="About EBP"
          icon="info"
          subtitle="Project info"
          onPress={() => navigation.navigate('ProjectInfo')}
          showDivider={false}
        />
      </ListSection>
      {DeveloperTools ? <DeveloperTools navigation={navigation} /> : null}
    </Screen>
  );
}
