import React, {useEffect} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import {ensureNativeCryptoReady} from './src/services/cryptoInit';

const App = () => {
  useEffect(() => {
    void ensureNativeCryptoReady();
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
};

export default App;
