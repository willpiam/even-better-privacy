module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    test: {
      plugins: ['@babel/plugin-transform-dynamic-import'],
    },
  },
};
