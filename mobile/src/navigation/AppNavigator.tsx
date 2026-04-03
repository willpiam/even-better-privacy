import React from 'react';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import CreateIdentityScreen from '../screens/CreateIdentityScreen';
import IdentityDetailScreen from '../screens/IdentityDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import SignVerifyScreen from '../screens/SignVerifyScreen';
import EncryptDecryptScreen from '../screens/EncryptDecryptScreen';
import CertificatesScreen from '../screens/CertificatesScreen';
import ProjectInfoScreen from '../screens/ProjectInfoScreen';

export type RootStackParamList = {
  Home: undefined;
  CreateIdentity: undefined;
  IdentityDetail: {identityName: string};
  Settings: undefined;
  Contacts: undefined;
  ContactDetail: {name: string};
  SignVerify: undefined;
  EncryptDecrypt: undefined;
  Certificates: undefined;
  ProjectInfo: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#fff',
    text: '#111',
    card: '#fff',
    border: '#ddd',
  },
};

export default function AppNavigator(): JSX.Element {
  return (
    <NavigationContainer theme={LightTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {backgroundColor: '#fff'},
          headerTintColor: '#111',
          headerTitleStyle: {color: '#111'},
        }}>
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
        <Stack.Screen
          name="Contacts"
          component={ContactsScreen}
          options={{title: 'Contacts'}}
        />
        <Stack.Screen
          name="ContactDetail"
          component={ContactDetailScreen}
          options={{title: 'Contact Detail'}}
        />
        <Stack.Screen
          name="SignVerify"
          component={SignVerifyScreen}
          options={{title: 'Sign / Verify'}}
        />
        <Stack.Screen
          name="EncryptDecrypt"
          component={EncryptDecryptScreen}
          options={{title: 'Encrypt / Decrypt'}}
        />
        <Stack.Screen
          name="Certificates"
          component={CertificatesScreen}
          options={{title: 'Certificates'}}
        />
        <Stack.Screen
          name="ProjectInfo"
          component={ProjectInfoScreen}
          options={{title: 'Project Info'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
