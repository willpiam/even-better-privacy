import {sha256Hex} from '../../../core/MessageHash.ts';

export type VerificationPart = 'offer' | 'proof';

const frameLength = 1000;
// Allow room for the largest supported SLH-DSA signature in base64.
const maxFrames = 72;
const framePattern =
  /^EBP-VERIFY-1:(offer|proof):([a-f0-9]{64}):([1-9]\d?)\/([1-9]\d?):([ -~]+)$/;

export function encodeVerificationFrames(
  part: VerificationPart,
  value: object,
): string[] {
  const data = JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  const count = Math.ceil(data.length / frameLength);
  if (count > maxFrames)
    throw new Error('This verification message is too large.');
  const digest = sha256Hex(data);
  return Array.from({length: count}, (_, index) => {
    const chunk = data.slice(index * frameLength, (index + 1) * frameLength);
    return `EBP-VERIFY-1:${part}:${digest}:${index + 1}/${count}:${chunk}`;
  });
}

export class VerificationScanner {
  private digest?: string;
  private total = 0;
  private readonly chunks = new Map<number, string>();

  constructor(private readonly part: VerificationPart) {}

  add(frame: string): {received: number; total: number; data?: string} {
    const match = frame.length <= frameLength + 100 && framePattern.exec(frame);
    if (!match || match[0] !== frame || match[1] !== this.part) {
      throw new Error(`Scan the other phone’s verification ${this.part}.`);
    }
    const [, , digest, position, count, chunk] = match;
    const index = Number(position);
    const total = Number(count);
    if (
      index > total ||
      total > maxFrames ||
      chunk.length > frameLength ||
      (index < total && chunk.length !== frameLength)
    ) {
      throw new Error('Invalid verification frame.');
    }
    if (this.digest && (this.digest !== digest || this.total !== total)) {
      throw new Error(
        'These codes come from different exchanges. Reopen the scanner.',
      );
    }
    const previous = this.chunks.get(index);
    if (previous !== undefined && previous !== chunk) {
      throw new Error('Conflicting verification frames. Reopen the scanner.');
    }
    this.digest = digest;
    this.total = total;
    this.chunks.set(index, chunk);
    const progress = {received: this.chunks.size, total};
    if (progress.received < total) return progress;

    const data = Array.from({length: total}, (_, i) =>
      this.chunks.get(i + 1),
    ).join('');
    if (sha256Hex(data) !== digest) {
      throw new Error('The verification data is damaged. Reopen the scanner.');
    }
    return {...progress, data};
  }
}

export function decodeNfcVerification(
  part: VerificationPart,
  payload: string,
): string {
  const scanner = new VerificationScanner(part);
  const frames = payload.split('\n');
  let result: ReturnType<VerificationScanner['add']> | undefined;
  for (const frame of frames) result = scanner.add(frame);
  if (!result?.data || frames.length !== result.total) {
    throw new Error('The NFC verification transfer was incomplete.');
  }
  return result.data;
}
