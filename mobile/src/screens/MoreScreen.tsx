import React, {useCallback, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import Screen from '../components/Screen';
import BrandHeader from '../components/BrandHeader';
import SectionTitle from '../components/SectionTitle';
import ListRow from '../components/ListRow';
import Card from '../components/Card';
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
      <BrandHeader />
      <SectionTitle>Preferences</SectionTitle>
      <Card>
        <ListRow
          testID="more-settings"
          title="Settings"
          subtitle={serverUrl || 'Server, auto-lock, password policy, mail'}
          onPress={() => navigation.navigate('Settings')}
          showDivider={false}
        />
      </Card>
      <SectionTitle>App</SectionTitle>
      <Card>
        <ListRow
          testID="more-about"
          title="About EBP"
          subtitle="Project info"
          onPress={() => navigation.navigate('ProjectInfo')}
          showDivider={false}
        />
      </Card>
      {DeveloperTools ? <DeveloperTools navigation={navigation} /> : null}
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: {height: 24},
});
