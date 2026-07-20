import React from 'react';
import {Text, StyleSheet} from 'react-native';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {colors} from '../theme/tokens';
import IdentitiesHomeScreen from '../screens/IdentitiesHomeScreen';
import CreateIdentityScreen from '../screens/CreateIdentityScreen';
import HdCreateScreen from '../screens/HdCreateScreen';
import IdentityDetailScreen from '../screens/IdentityDetailScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import SignVerifyScreen from '../screens/SignVerifyScreen';
import EncryptDecryptScreen from '../screens/EncryptDecryptScreen';
import MailAccountsScreen from '../screens/mail/MailAccountsScreen';
import MailAccountSetupScreen from '../screens/mail/MailAccountSetupScreen';
import MailInboxScreen from '../screens/mail/MailInboxScreen';
import MailMessageScreen from '../screens/mail/MailMessageScreen';
import MailComposeScreen from '../screens/mail/MailComposeScreen';
import MoreScreen from '../screens/MoreScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CertificatesScreen from '../screens/CertificatesScreen';
import ProjectInfoScreen from '../screens/ProjectInfoScreen';
import MailTraceScreen from '../screens/mail/MailTraceScreen';

export type IdentitiesStackParamList = {
  IdentitiesHome: undefined;
  CreateIdentity: undefined;
  HdCreate: undefined;
  IdentityDetail: {identityName: string};
};

export type ContactsStackParamList = {
  ContactsList: undefined;
  ContactDetail: {name: string};
};

export type CryptoStackParamList = {
  SignVerify: undefined;
  EncryptDecrypt: undefined;
};

export type MailStackParamList = {
  MailAccounts: undefined;
  MailAccountSetup: {accountId?: string};
  MailInbox: undefined;
  MailMessage: {uid: number};
  MailCompose: undefined;
};

export type MoreStackParamList = {
  MoreHome: undefined;
  Settings: undefined;
  Certificates: undefined;
  ProjectInfo: undefined;
  MailTrace: undefined;
};

export type RootTabParamList = {
  IdentitiesTab: undefined;
  ContactsTab: undefined;
  CryptoTab: undefined;
  MailTab: undefined;
  MoreTab: undefined;
};

/** @deprecated Use stack-specific param lists */
export type RootStackParamList = IdentitiesStackParamList &
  ContactsStackParamList &
  CryptoStackParamList &
  MailStackParamList &
  MoreStackParamList;

const Tab = createBottomTabNavigator<RootTabParamList>();
const IdentitiesStack = createNativeStackNavigator<IdentitiesStackParamList>();
const ContactsStack = createNativeStackNavigator<ContactsStackParamList>();
const CryptoStack = createNativeStackNavigator<CryptoStackParamList>();
const MailStack = createNativeStackNavigator<MailStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.page,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

const stackScreenOptions = {
  headerStyle: {backgroundColor: colors.surface},
  headerTintColor: colors.accent,
  headerTitleStyle: {color: colors.text, fontWeight: '600' as const},
  headerShadowVisible: false,
  contentStyle: {backgroundColor: colors.page},
};

function TabIcon({label, focused}: {label: string; focused: boolean}) {
  return (
    <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>{label}</Text>
  );
}

function IdentitiesNavigator(): JSX.Element {
  return (
    <IdentitiesStack.Navigator screenOptions={stackScreenOptions}>
      <IdentitiesStack.Screen
        name="IdentitiesHome"
        component={IdentitiesHomeScreen}
        options={{title: 'Identities'}}
      />
      <IdentitiesStack.Screen
        name="CreateIdentity"
        component={CreateIdentityScreen}
        options={{title: 'Create Identity'}}
      />
      <IdentitiesStack.Screen
        name="HdCreate"
        component={HdCreateScreen}
        options={{title: 'EBP-HD'}}
      />
      <IdentitiesStack.Screen
        name="IdentityDetail"
        component={IdentityDetailScreen}
        options={{title: 'Identity'}}
      />
    </IdentitiesStack.Navigator>
  );
}

function ContactsNavigator(): JSX.Element {
  return (
    <ContactsStack.Navigator screenOptions={stackScreenOptions}>
      <ContactsStack.Screen
        name="ContactsList"
        component={ContactsScreen}
        options={{title: 'Contacts'}}
      />
      <ContactsStack.Screen
        name="ContactDetail"
        component={ContactDetailScreen}
        options={{title: 'Contact'}}
      />
    </ContactsStack.Navigator>
  );
}

function CryptoNavigator(): JSX.Element {
  return (
    <CryptoStack.Navigator screenOptions={stackScreenOptions}>
      <CryptoStack.Screen
        name="SignVerify"
        component={SignVerifyScreen}
        options={{title: 'Crypto'}}
      />
      <CryptoStack.Screen
        name="EncryptDecrypt"
        component={EncryptDecryptScreen}
        options={{title: 'Crypto'}}
      />
    </CryptoStack.Navigator>
  );
}

function MailNavigator(): JSX.Element {
  return (
    <MailStack.Navigator screenOptions={stackScreenOptions}>
      <MailStack.Screen
        name="MailAccounts"
        component={MailAccountsScreen}
        options={{title: 'Mail'}}
      />
      <MailStack.Screen
        name="MailAccountSetup"
        component={MailAccountSetupScreen}
        options={({route}) => ({
          title: route.params?.accountId ? 'Edit Account' : 'Add Account',
        })}
      />
      <MailStack.Screen
        name="MailInbox"
        component={MailInboxScreen}
        options={{title: 'Inbox'}}
      />
      <MailStack.Screen
        name="MailMessage"
        component={MailMessageScreen}
        options={{title: 'Message'}}
      />
      <MailStack.Screen
        name="MailCompose"
        component={MailComposeScreen}
        options={{title: 'Compose'}}
      />
    </MailStack.Navigator>
  );
}

function MoreNavigator(): JSX.Element {
  return (
    <MoreStack.Navigator screenOptions={stackScreenOptions}>
      <MoreStack.Screen
        name="MoreHome"
        component={MoreScreen}
        options={{title: 'More'}}
      />
      <MoreStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{title: 'Settings'}}
      />
      <MoreStack.Screen
        name="Certificates"
        component={CertificatesScreen}
        options={{title: 'Certificates'}}
      />
      <MoreStack.Screen
        name="ProjectInfo"
        component={ProjectInfoScreen}
        options={{title: 'Project Info'}}
      />
      <MoreStack.Screen
        name="MailTrace"
        component={MailTraceScreen}
        options={{title: 'Mail Trace'}}
      />
    </MoreStack.Navigator>
  );
}

export default function AppNavigator(): JSX.Element {
  return (
    <NavigationContainer theme={LightTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
          },
        }}>
        <Tab.Screen
          name="IdentitiesTab"
          component={IdentitiesNavigator}
          options={{
            title: 'Identities',
            tabBarIcon: ({focused}) => <TabIcon label="◎" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="ContactsTab"
          component={ContactsNavigator}
          options={{
            title: 'Contacts',
            tabBarIcon: ({focused}) => <TabIcon label="◉" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="CryptoTab"
          component={CryptoNavigator}
          options={{
            title: 'Crypto',
            tabBarIcon: ({focused}) => <TabIcon label="⬡" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="MailTab"
          component={MailNavigator}
          options={{
            title: 'Mail',
            tabBarIcon: ({focused}) => <TabIcon label="✉" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="MoreTab"
          component={MoreNavigator}
          options={{
            title: 'More',
            tabBarIcon: ({focused}) => <TabIcon label="⋯" focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 16,
    color: colors.muted,
  },
  tabIconActive: {
    color: colors.accent,
  },
});
