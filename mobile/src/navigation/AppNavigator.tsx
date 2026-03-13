import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import CreateIdentityScreen from '../screens/CreateIdentityScreen';
import IdentityDetailScreen from '../screens/IdentityDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  Home: undefined;
  CreateIdentity: undefined;
  IdentityDetail: {identityName: string};
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator(): JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{title: 'EBP Mobile'}}
        />
        <Stack.Screen
          name="CreateIdentity"
          component={CreateIdentityScreen}
          options={{title: 'Create Identity'}}
        />
        <Stack.Screen
          name="IdentityDetail"
          component={IdentityDetailScreen}
          options={{title: 'Identity'}}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{title: 'Settings'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
