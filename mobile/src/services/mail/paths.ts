import RNFS from 'react-native-fs';
import {BASE_DIR} from '../storage';

export function identityMailDir(identityName: string): string {
  return `${BASE_DIR}/${identityName}`;
}

export function mailAccountPath(identityName: string): string {
  return `${identityMailDir(identityName)}/mail-account.json`;
}

export function mailSecretsPath(identityName: string): string {
  return `${identityMailDir(identityName)}/mail-account.secrets.json`;
}

export async function ensureIdentityMailDir(identityName: string): Promise<string> {
  const dir = identityMailDir(identityName);
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  return dir;
}
