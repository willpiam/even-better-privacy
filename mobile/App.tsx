import React, {useEffect} from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import {ensureNativeCryptoReady} from './src/services/cryptoInit';

const App = () => {
  useEffect(() => {
    void ensureNativeCryptoReady();
  }, []);

  return <AppNavigator />;
};

export default App;
