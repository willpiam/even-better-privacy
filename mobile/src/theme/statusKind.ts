/**
 * Infer banner kind from a status string when screens don't classify errors.
 */
export function statusKind(
  message: string,
  explicit?: 'info' | 'success' | 'error',
): 'info' | 'success' | 'error' {
  if (explicit) {
    return explicit;
  }
  const lower = message.toLowerCase();
  if (
    lower.includes('fail') ||
    lower.includes('error') ||
    lower.includes('invalid') ||
    lower.includes('mismatch') ||
    lower.includes('required') ||
    lower.includes('could not') ||
    lower.includes('unable') ||
    lower.includes('has no') ||
    lower.includes('no verified') ||
    lower.includes('not verified')
  ) {
    return 'error';
  }
  if (
    lower.includes('success') ||
    lower.includes('created') ||
    lower.includes('saved') ||
    lower.includes('signed') ||
    lower.includes('verified') ||
    lower.includes('encrypted') ||
    lower.includes('decrypted') ||
    lower.includes('published') ||
    lower.includes('imported') ||
    lower.includes('synced')
  ) {
    return 'success';
  }
  return 'info';
}
