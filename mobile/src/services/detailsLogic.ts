/**
 * Pure detail-path helpers (Deno/Jest-testable).
 */
import {sha256Hex} from '../../../core/MessageHash.ts';

/**
 * Opaque detail paths store the SHA-256 of the cleartext, not the cleartext.
 */
export function prepareDetailValue(path: string, detail: string): string {
  return path.startsWith('opaque::') ? sha256Hex(detail) : detail;
}

export function requirePathAndDetail(path: string, detail: string): void {
  if (!path || !detail) {
    throw new Error('Path and detail are required');
  }
}
