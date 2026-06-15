import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_SERVER_URL} from '../config/constants';

const SERVER_URL_KEY = 'ebp.server_url';
/** Matches GUI localStorage key `ebp.identity.enforcePasswordPolicy`. */
export const ENFORCE_PASSWORD_POLICY_KEY = 'ebp.identity.enforcePasswordPolicy';
export const MAIL_RENDER_HTML_KEY = 'ebp.mail.renderHtml';
export const MAIL_INCLUDE_PUBLIC_KEYS_KEY = 'ebp.mail.includePublicKeys';

async function getBooleanPref(key: string, fallback: boolean): Promise<boolean> {
  const value = await AsyncStorage.getItem(key);
  if (value === null) {
    return fallback;
  }
  return value === 'true';
}

async function setBooleanPref(key: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(key, value ? 'true' : 'false');
}

export const MAIL_OAUTH_GMAIL_CLIENT_ID_OVERRIDE_KEY =
  'ebp.mail.oauth.gmailClientIdOverride';
export const MAIL_OAUTH_OUTLOOK_CLIENT_ID_OVERRIDE_KEY =
  'ebp.mail.oauth.outlookClientIdOverride';

async function getOptionalStringPref(key: string): Promise<string> {
  const value = await AsyncStorage.getItem(key);
  return value?.trim() ?? '';
}

async function setOptionalStringPref(key: string, value: string): Promise<void> {
  const clean = value.trim();
  if (clean) {
    await AsyncStorage.setItem(key, clean);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

export async function getMailOauthGmailClientIdOverride(): Promise<string> {
  return getOptionalStringPref(MAIL_OAUTH_GMAIL_CLIENT_ID_OVERRIDE_KEY);
}

export async function setMailOauthGmailClientIdOverride(value: string): Promise<void> {
  await setOptionalStringPref(MAIL_OAUTH_GMAIL_CLIENT_ID_OVERRIDE_KEY, value);
}

export async function getMailOauthOutlookClientIdOverride(): Promise<string> {
  return getOptionalStringPref(MAIL_OAUTH_OUTLOOK_CLIENT_ID_OVERRIDE_KEY);
}

export async function setMailOauthOutlookClientIdOverride(value: string): Promise<void> {
  await setOptionalStringPref(MAIL_OAUTH_OUTLOOK_CLIENT_ID_OVERRIDE_KEY, value);
}

export async function getServerUrl(): Promise<string> {
  const value = await AsyncStorage.getItem(SERVER_URL_KEY);
  return value && value.trim().length > 0 ? value.trim() : DEFAULT_SERVER_URL;
}

export async function setServerUrl(next: string): Promise<void> {
  const clean = next.trim();
  if (!clean) {
    throw new Error('Server URL cannot be empty');
  }
  await AsyncStorage.setItem(SERVER_URL_KEY, clean);
}

export async function getEnforcePasswordPolicy(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ENFORCE_PASSWORD_POLICY_KEY);
  if (value === null) {
    return true;
  }
  return value === 'true';
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
