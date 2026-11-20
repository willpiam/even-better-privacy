import React from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {colors, radius, spacing, typography} from '../theme/tokens';
import {places, PlaceThemeProvider, type Place} from '../theme/PlaceTheme';
import AppIcon, {type IconName} from '../components/AppIcon';
import BrandHeader from '../components/BrandHeader';
import {mailColors} from '../screens/mail/MailAppearance';
import IdentitiesHomeScreen from '../screens/IdentitiesHomeScreen';
import HdCreateScreen from '../screens/HdCreateScreen';
import OnboardingWizardScreen from '../screens/OnboardingWizardScreen';
import IdentityDetailScreen from '../screens/IdentityDetailScreen';
import IdentityActionsScreen from '../screens/IdentityActionsScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import CryptoHubScreen from '../screens/CryptoHubScreen';
import SignMessageScreen from '../screens/crypto/SignMessageScreen';
import VerifyMessageScreen from '../screens/crypto/VerifyMessageScreen';
import SignFileScreen from '../screens/crypto/SignFileScreen';
import VerifyFileScreen from '../screens/crypto/VerifyFileScreen';
import FingerprintToolScreen from '../screens/crypto/FingerprintToolScreen';
import EncryptMessageScreen from '../screens/crypto/EncryptMessageScreen';
import DecryptMessageScreen from '../screens/crypto/DecryptMessageScreen';
import EncryptFileScreen from '../screens/crypto/EncryptFileScreen';
import DecryptFileScreen from '../screens/crypto/DecryptFileScreen';
import MailAccountsScreen from '../screens/mail/MailAccountsScreen';
import MailAccountSettingsScreen from '../screens/mail/MailAccountSettingsScreen';
import MailAccountSetupScreen from '../screens/mail/MailAccountSetupScreen';
import MailHelpScreen from '../screens/mail/MailHelpScreen';
import MailInboxScreen from '../screens/mail/MailInboxScreen';
import MailMessageScreen from '../screens/mail/MailMessageScreen';
import MailSenderAuthenticityScreen from '../screens/mail/MailSenderAuthenticityScreen';
import MailComposeScreen from '../screens/mail/MailComposeScreen';
import type {MailAuthenticitySummary} from '../services/mail/ebpMail';
import MoreScreen from '../screens/MoreScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProjectInfoScreen from '../screens/ProjectInfoScreen';

export type IdentitiesStackParamList = {
  IdentitiesHome: undefined;
  HdCreate: undefined;
  OnboardingWizard: undefined;
  IdentityDetail: {identityName: string};
  IdentityPublish: {identityName: string};
  IdentityDetails: {identityName: string};
  IdentityExport: {identityName: string};
  IdentitySecurity: {identityName: string};
};

export type ContactsStackParamList = {
  ContactsList: undefined;
  ContactDetail: {name: string};
};

export type CryptoStackParamList = {
  CryptoHub: undefined;
  SignMessage: undefined;
  VerifyMessage: undefined;
  SignFile: undefined;
  VerifyFile: undefined;
  FingerprintTool: undefined;
  EncryptMessage: undefined;
  DecryptMessage: undefined;
  EncryptFile: undefined;
  DecryptFile: undefined;
};

export type MailStackParamList = {
  MailAccounts: undefined;
  MailAccountSetup: {accountId?: string};
  MailHelp: undefined;
  OnboardingWizard: undefined;
  MailInbox: undefined;
  MailMessage: {uid: number; folder?: string};
  MailSenderAuthenticity: {summary: MailAuthenticitySummary};
  MailCompose:
    | {
        draftId?: string;
        to?: string;
        subject?: string;
        message?: string;
        recipientContact?: string;
        encryptionIntent?: 'encrypted' | 'unencrypted';
        inReplyTo?: string;
        references?: string;
      }
    | undefined;
};

export type MoreStackParamList = {
  MoreHome: undefined;
  Settings: undefined;
  MailAccountSettings: undefined;
  MailAccountSetup: MailStackParamList['MailAccountSetup'];
  OnboardingWizard: undefined;
  Diagnostics: undefined;
  ProjectInfo: undefined;
  MailTrace: undefined;
};

export type RootTabParamList = {
  IdentitiesTab: NavigatorScreenParams<IdentitiesStackParamList> | undefined;
  ContactsTab: undefined;
  CryptoTab: undefined;
  MailTab: NavigatorScreenParams<MailStackParamList> | undefined;
  MoreTab: NavigatorScreenParams<MoreStackParamList> | undefined;
};

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

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
  headerStyle: {backgroundColor: colors.page},
  headerTintColor: colors.accent,
  headerTitleStyle: {
    color: colors.text,
    fontWeight: '600' as const,
    fontSize: 17,
  },
  headerShadowVisible: false,
  contentStyle: {backgroundColor: colors.page},
};

function placeOptions(place: Place) {
  return {
    ...stackScreenOptions,
    headerTintColor: places[place].accent,
  };
}

const homeOptions = {headerTitle: () => <BrandHeader compact />};

function TabIcon({
  name,
  focused,
  place,
}: {
  name: IconName;
  focused: boolean;
  place: Place;
}) {
  return (
    <View
      style={[
        styles.tabIcon,
        focused && {backgroundColor: places[place].pale},
      ]}>
      <AppIcon
        name={name}
        color={focused ? places[place].accent : colors.muted}
        size={21}
      />
    </View>
  );
}

function IdentitiesNavigator(): JSX.Element {
  return (
    <PlaceThemeProvider place="identities">
      <IdentitiesStack.Navigator screenOptions={placeOptions('identities')}>
        <IdentitiesStack.Screen
          name="IdentitiesHome"
          component={IdentitiesHomeScreen}
          options={{title: 'Identities', ...homeOptions}}
        />
        <IdentitiesStack.Screen
          name="HdCreate"
          component={HdCreateScreen}
          options={{title: 'Create Identity'}}
        />
        <IdentitiesStack.Screen
          name="OnboardingWizard"
          component={OnboardingWizardScreen}
          options={{title: 'Get started'}}
        />
        <IdentitiesStack.Screen
          name="IdentityDetail"
          component={IdentityDetailScreen}
          options={{title: 'Identity'}}
        />
        <IdentitiesStack.Screen
          name="IdentityPublish"
          component={IdentityActionsScreen}
          options={{title: 'Publish identity'}}
        />
        <IdentitiesStack.Screen
          name="IdentityDetails"
          component={IdentityActionsScreen}
          options={{title: 'Identity details'}}
        />
        <IdentitiesStack.Screen
          name="IdentityExport"
          component={IdentityActionsScreen}
          options={{title: 'Export and backup'}}
        />
        <IdentitiesStack.Screen
          name="IdentitySecurity"
          component={IdentityActionsScreen}
          options={{title: 'Revocation and removal'}}
        />
      </IdentitiesStack.Navigator>
    </PlaceThemeProvider>
  );
}

function ContactsNavigator(): JSX.Element {
  return (
    <PlaceThemeProvider place="contacts">
      <ContactsStack.Navigator screenOptions={placeOptions('contacts')}>
        <ContactsStack.Screen
          name="ContactsList"
          component={ContactsScreen}
          options={{title: 'Contacts', ...homeOptions}}
        />
        <ContactsStack.Screen
          name="ContactDetail"
          component={ContactDetailScreen}
          options={{title: 'Contact'}}
        />
      </ContactsStack.Navigator>
    </PlaceThemeProvider>
  );
}

function CryptoNavigator(): JSX.Element {
  return (
    <PlaceThemeProvider place="tools">
      <CryptoStack.Navigator screenOptions={placeOptions('tools')}>
        <CryptoStack.Screen
          name="CryptoHub"
          component={CryptoHubScreen}
          options={{title: 'Crypto', ...homeOptions}}
        />
        <CryptoStack.Screen
          name="SignMessage"
          component={SignMessageScreen}
          options={{title: 'Sign Message'}}
        />
        <CryptoStack.Screen
          name="VerifyMessage"
          component={VerifyMessageScreen}
          options={{title: 'Verify Message'}}
        />
        <CryptoStack.Screen
          name="SignFile"
          component={SignFileScreen}
          options={{title: 'Sign File'}}
        />
        <CryptoStack.Screen
          name="VerifyFile"
          component={VerifyFileScreen}
          options={{title: 'Verify File'}}
        />
        <CryptoStack.Screen
          name="FingerprintTool"
          component={FingerprintToolScreen}
          options={{title: 'Fingerprint'}}
        />
        <CryptoStack.Screen
          name="EncryptMessage"
          component={EncryptMessageScreen}
          options={{title: 'Encrypt Message'}}
        />
        <CryptoStack.Screen
          name="DecryptMessage"
          component={DecryptMessageScreen}
          options={{title: 'Decrypt Message'}}
        />
        <CryptoStack.Screen
          name="EncryptFile"
          component={EncryptFileScreen}
          options={{title: 'Encrypt File'}}
        />
        <CryptoStack.Screen
          name="DecryptFile"
          component={DecryptFileScreen}
          options={{title: 'Decrypt File'}}
        />
      </CryptoStack.Navigator>
    </PlaceThemeProvider>
  );
}

function MailNavigator(): JSX.Element {
  return (
    <PlaceThemeProvider place="mail">
      <MailStack.Navigator
        screenOptions={{
          ...stackScreenOptions,
          headerStyle: {backgroundColor: mailColors.page},
          headerTintColor: mailColors.accent,
          headerTitleStyle: {color: mailColors.text, fontWeight: '600'},
          contentStyle: {backgroundColor: mailColors.page},
        }}>
        <MailStack.Screen
          name="MailAccounts"
          component={MailAccountsScreen}
          options={{title: 'Mail', ...homeOptions}}
        />
        <MailStack.Screen
          name="MailAccountSetup"
          component={MailAccountSetupScreen}
          options={({route}) => ({
            title: route.params?.accountId ? 'Edit Account' : 'Add Account',
          })}
        />
        <MailStack.Screen
          name="MailHelp"
          component={MailHelpScreen}
          options={{title: 'Mail help'}}
        />
        <MailStack.Screen
          name="OnboardingWizard"
          component={OnboardingWizardScreen}
          options={{title: 'Create EBP email'}}
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
          name="MailSenderAuthenticity"
          component={MailSenderAuthenticityScreen}
          options={{title: 'Sender authenticity'}}
        />
        <MailStack.Screen
          name="MailCompose"
          getId={({params}) => params?.draftId}
          component={MailComposeScreen}
          options={{title: 'New message'}}
        />
      </MailStack.Navigator>
    </PlaceThemeProvider>
  );
}

function MoreNavigator(): JSX.Element {
  return (
    <PlaceThemeProvider place="settings">
      <MoreStack.Navigator screenOptions={placeOptions('settings')}>
        <MoreStack.Screen
          name="MoreHome"
          component={MoreScreen}
          options={{title: 'More', ...homeOptions}}
        />
        <MoreStack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{title: 'Settings'}}
        />
        <MoreStack.Screen
          name="MailAccountSettings"
          component={MailAccountSettingsScreen}
          options={{title: 'Mail accounts'}}
        />
        <MoreStack.Screen
          name="MailAccountSetup"
          component={MailAccountSetupScreen}
          options={({route}) => ({
            title: route.params?.accountId ? 'Edit Account' : 'Add Account',
          })}
        />
        <MoreStack.Screen
          name="OnboardingWizard"
          component={OnboardingWizardScreen}
          options={{title: 'Create EBP email'}}
        />
        {__DEV__ && (
          <MoreStack.Screen
            name="Diagnostics"
            getComponent={() => require('../screens/DiagnosticsScreen').default}
            options={{title: 'Diagnostics'}}
          />
        )}
        <MoreStack.Screen
          name="ProjectInfo"
          component={ProjectInfoScreen}
          options={{title: 'Project Info'}}
        />
        {__DEV__ && (
          <MoreStack.Screen
            name="MailTrace"
            getComponent={() =>
              require('../screens/mail/MailTraceScreen').default
            }
            options={{title: 'Mail Trace'}}
          />
        )}
      </MoreStack.Navigator>
    </PlaceThemeProvider>
  );
}

export default function AppNavigator(): JSX.Element {
  return (
    <NavigationContainer ref={navigationRef} theme={LightTheme}>
      <StatusBar barStyle="dark-content" />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            paddingTop: spacing.xs,
            minHeight: 76,
            elevation: 0,
          },
          tabBarLabelStyle: {
            fontSize: typography.tab,
            fontWeight: '600',
          },
        }}>
        <Tab.Screen
          name="IdentitiesTab"
          component={IdentitiesNavigator}
          options={{
            title: 'Identities',
            tabBarButtonTestID: 'tab-identities',
            tabBarIcon: ({focused}) => (
              <TabIcon name="key" place="identities" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="ContactsTab"
          component={ContactsNavigator}
          options={{
            title: 'Contacts',
            tabBarActiveTintColor: places.contacts.accent,
            tabBarButtonTestID: 'tab-contacts',
            tabBarIcon: ({focused}) => (
              <TabIcon name="contacts" place="contacts" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="CryptoTab"
          component={CryptoNavigator}
          options={{
            title: 'Crypto',
            tabBarActiveTintColor: places.tools.accent,
            tabBarButtonTestID: 'tab-crypto',
            tabBarIcon: ({focused}) => (
              <TabIcon name="shield" place="tools" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="MailTab"
          component={MailNavigator}
          options={{
            title: 'Mail',
            tabBarActiveTintColor: places.mail.accent,
            tabBarButtonTestID: 'tab-mail',
            tabBarIcon: ({focused}) => (
              <TabIcon name="mail" place="mail" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="MoreTab"
          component={MoreNavigator}
          options={{
            title: 'More',
            tabBarActiveTintColor: places.settings.accent,
            tabBarButtonTestID: 'tab-more',
            tabBarIcon: ({focused}) => (
              <TabIcon name="more" place="settings" focused={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
