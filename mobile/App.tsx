import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import AppNavigator, {navigationRef} from './src/navigation/AppNavigator';
import MailSendProvider from './src/components/MailSendProvider';

const App = () => {
  return (
    <SafeAreaProvider>
      <MailSendProvider
        recover={draftId => {
          if (navigationRef.isReady())
            navigationRef.navigate('MailTab', {
              screen: 'MailCompose',
              params: {draftId},
            });
        }}>
        <AppNavigator />
      </MailSendProvider>
    </SafeAreaProvider>
  );
};

export default App;
