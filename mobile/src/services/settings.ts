import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_SERVER_URL} from '../config/constants';

const SERVER_URL_KEY = 'ebp.server_url';
/** Matches GUI localStorage key `ebp.identity.enforcePasswordPolicy`. */
export const ENFORCE_PASSWORD_POLICY_KEY = 'ebp.identity.enforcePasswordPolicy';

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
  await AsyncStorage.setItem(
    ENFORCE_PASSWORD_POLICY_KEY,
    enforce ? 'true' : 'false',
  );
}
