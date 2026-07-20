module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-safe-area-context|react-native-screens|react-native-fs|react-native-tcp-socket|react-native-share|react-native-get-random-values|react-native-quick-crypto|react-native-libsodium|react-native-quick-base64|@react-native-async-storage|@react-native-clipboard|@react-native-documents)/)',
  ],
};
