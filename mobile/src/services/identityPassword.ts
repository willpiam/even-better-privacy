import {DecryptionAuthError} from '../../../core/AES';

/** Try the exact password first; older mobile files silently trimmed it. */
export async function withIdentityPassword<T>(
  password: string,
  decrypt: (candidate: string) => Promise<T>,
): Promise<{value: T; password: string}> {
  if (!password) throw new Error('Password is required');
  try {
    return {value: await decrypt(password), password};
  } catch (error) {
    const legacy = password.trim();
    if (
      !(error instanceof DecryptionAuthError) ||
      !legacy ||
      legacy === password
    ) {
      throw error;
    }
    return {value: await decrypt(legacy), password: legacy};
  }
}
