module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-safe-area-context|react-native-screens|react-native-fs|react-native-tcp-socket|react-native-share|react-native-get-random-values|react-native-quick-crypto|react-native-libsodium|react-native-quick-base64|@react-native-async-storage|@react-native-clipboard|@react-native-documents|@noble)/)',
  ],
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^@noble/hashes/(.*)$': '<rootDir>/node_modules/@noble/hashes/$1',
    '^@noble/ciphers/(.*)$': '<rootDir>/node_modules/@noble/ciphers/$1',
    '^bech32$': '<rootDir>/node_modules/bech32',
  },
};
