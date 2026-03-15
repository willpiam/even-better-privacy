/**
 * @format
 */

import 'react-native-get-random-values';
import {Buffer} from 'buffer';
import './shims';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

if (typeof global.btoa !== 'function') {
  global.btoa = value => Buffer.from(value, 'binary').toString('base64');
}

if (typeof global.atob !== 'function') {
  global.atob = value => Buffer.from(value, 'base64').toString('binary');
}

AppRegistry.registerComponent(appName, () => App);
