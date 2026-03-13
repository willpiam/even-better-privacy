import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_SERVER_URL} from '../config/constants';

const SERVER_URL_KEY = 'ebp.server_url';

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
