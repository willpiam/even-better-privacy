import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_SERVER_URL} from '../config/constants';
import {
  booleanPrefToStorage,
  clampAutoLockMinutes,
  numberPrefToStorage,
  parseAutoLockMinutes,
  parseEnforcePasswordPolicy,
  parseStoredBoolean,
  requireNonEmptyServerUrl,
  resolveServerUrl,
} from './settingsLogic';

export {
  booleanPrefToStorage,
  clampAutoLockMinutes,
  DEFAULT_AUTO_LOCK_MINUTES,
  AUTO_LOCK_MINUTE_OPTIONS,
  numberPrefToStorage,
  parseAutoLockMinutes,
  parseEnforcePasswordPolicy,
  parseStoredBoolean,
  parseStoredNumber,
  requireNonEmptyServerUrl,
  resolveServerUrl,
} from './settingsLogic';

const SERVER_URL_KEY = 'ebp.server_url';
/** Matches GUI localStorage key `ebp.identity.enforcePasswordPolicy`. */
export const ENFORCE_PASSWORD_POLICY_KEY = 'ebp.identity.enforcePasswordPolicy';
export const MAIL_RENDER_HTML_KEY = 'ebp.mail.renderHtml';
export const MAIL_INCLUDE_PUBLIC_KEYS_KEY = 'ebp.mail.includePublicKeys';
/** Matches GUI localStorage key `ebp.identity.autoLockMinutes`. */
export const AUTO_LOCK_MINUTES_KEY = 'ebp.identity.autoLockMinutes';

async function getBooleanPref(key: string, fallback: boolean): Promise<boolean> {
  const value = await AsyncStorage.getItem(key);
  return parseStoredBoolean(value, fallback);
}

async function setBooleanPref(key: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(key, booleanPrefToStorage(value));
}

export async function getServerUrl(): Promise<string> {
  const value = await AsyncStorage.getItem(SERVER_URL_KEY);
  return resolveServerUrl(value, DEFAULT_SERVER_URL);
}

export async function setServerUrl(next: string): Promise<void> {
  const clean = requireNonEmptyServerUrl(next);
  await AsyncStorage.setItem(SERVER_URL_KEY, clean);
}

export async function getEnforcePasswordPolicy(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ENFORCE_PASSWORD_POLICY_KEY);
  return parseEnforcePasswordPolicy(value);
}

export async function setEnforcePasswordPolicy(enforce: boolean): Promise<void> {
  await setBooleanPref(ENFORCE_PASSWORD_POLICY_KEY, enforce);
}

export async function getMailRenderHtml(): Promise<boolean> {
  return getBooleanPref(MAIL_RENDER_HTML_KEY, false);
}

export async function setMailRenderHtml(value: boolean): Promise<void> {
  await setBooleanPref(MAIL_RENDER_HTML_KEY, value);
}

export async function getMailIncludePublicKeys(): Promise<boolean> {
  return getBooleanPref(MAIL_INCLUDE_PUBLIC_KEYS_KEY, true);
}

export async function setMailIncludePublicKeys(value: boolean): Promise<void> {
  await setBooleanPref(MAIL_INCLUDE_PUBLIC_KEYS_KEY, value);
}

export async function getAutoLockMinutes(): Promise<number> {
  const value = await AsyncStorage.getItem(AUTO_LOCK_MINUTES_KEY);
  return parseAutoLockMinutes(value);
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const clamped = clampAutoLockMinutes(minutes);
  await AsyncStorage.setItem(AUTO_LOCK_MINUTES_KEY, numberPrefToStorage(clamped));
}
