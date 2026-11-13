import AsyncStorage from '@react-native-async-storage/async-storage';
import {KeyedQueue} from '../../../common/KeyedQueue';

const LOG_KEY = 'ebp.mobile.activityLog';
const LOG_LIMIT = 50;
const writes = new KeyedQueue();

export type ActivityLogEntry = {
  at: number;
  kind: 'info' | 'success' | 'error';
  message: string;
};

export async function appendActivityLog(
  message: string,
  kind: ActivityLogEntry['kind'] = 'info',
): Promise<void> {
  await writes.run(LOG_KEY, async () => {
    const entries = await listActivityLog();
    entries.unshift({at: Date.now(), kind, message});
    await AsyncStorage.setItem(
      LOG_KEY,
      JSON.stringify(entries.slice(0, LOG_LIMIT)),
    );
  });
}

export async function listActivityLog(): Promise<ActivityLogEntry[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as ActivityLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearActivityLog(): Promise<void> {
  await writes.run(LOG_KEY, () => AsyncStorage.removeItem(LOG_KEY));
}
