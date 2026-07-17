import React from 'react';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import CreateIdentityScreen from '../screens/CreateIdentityScreen';
import HdCreateScreen from '../screens/HdCreateScreen';
import IdentityDetailScreen from '../screens/IdentityDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import SignVerifyScreen from '../screens/SignVerifyScreen';
import EncryptDecryptScreen from '../screens/EncryptDecryptScreen';
import CertificatesScreen from '../screens/CertificatesScreen';
import ProjectInfoScreen from '../screens/ProjectInfoScreen';
import MailAccountsScreen from '../screens/mail/MailAccountsScreen';
import MailAccountSetupScreen from '../screens/mail/MailAccountSetupScreen';
import MailInboxScreen from '../screens/mail/MailInboxScreen';
import MailMessageScreen from '../screens/mail/MailMessageScreen';
import MailComposeScreen from '../screens/mail/MailComposeScreen';
import MailTraceScreen from '../screens/mail/MailTraceScreen';

export type RootStackParamList = {
  Home: undefined;
  CreateIdentity: undefined;
  HdCreate: undefined;
  IdentityDetail: {identityName: string};
  Settings: undefined;
  Contacts: undefined;
  ContactDetail: {name: string};
  SignVerify: undefined;
  EncryptDecrypt: undefined;
  Certificates: undefined;
  ProjectInfo: undefined;
  MailAccounts: undefined;
  MailAccountSetup: {accountId?: string};
  MailInbox: undefined;
  MailMessage: {uid: number};
  MailCompose: undefined;
  MailTrace: undefined;
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
          name="HdCreate"
          component={HdCreateScreen}
          options={{title: 'EBP-HD'}}
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
        <Stack.Screen
          name="MailAccounts"
          component={MailAccountsScreen}
          options={{title: 'Mail Accounts'}}
        />
        <Stack.Screen
          name="MailAccountSetup"
          component={MailAccountSetupScreen}
          options={({route}) => ({
            title: route.params?.accountId ? 'Edit mail account' : 'Add mail account',
          })}
        />
        <Stack.Screen
          name="MailInbox"
          component={MailInboxScreen}
          options={{title: 'Inbox'}}
        />
        <Stack.Screen
          name="MailMessage"
          component={MailMessageScreen}
          options={{title: 'Message'}}
        />
        <Stack.Screen
          name="MailCompose"
          component={MailComposeScreen}
          options={{title: 'Compose'}}
        />
        <Stack.Screen
          name="MailTrace"
          component={MailTraceScreen}
          options={{title: 'Mail trace stubs'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
