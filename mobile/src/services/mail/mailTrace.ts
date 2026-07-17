import AsyncStorage from '@react-native-async-storage/async-storage';

const TRACE_KEY = 'ebp.mobile.mailTrace';
const TRACE_LIMIT = 200;

export type MailTraceEntry = {
  at: number;
  seq: number;
  stub: string;
  detail?: string;
};

let memory: MailTraceEntry[] = [];
let nextSeq = 1;
let persistChain: Promise<void> = Promise.resolve();

function truncateDetail(detail: string | undefined): string | undefined {
  if (detail == null || detail === '') {
    return undefined;
  }
  return detail.length > 240 ? `${detail.slice(0, 237)}...` : detail;
}

async function persistMemory(): Promise<void> {
  await AsyncStorage.setItem(TRACE_KEY, JSON.stringify(memory));
}

/**
 * Record a mail connection probe point. Safe to call before awaits so hangs
 * leave the last stub visible in memory / AsyncStorage / Metro.
 * Never pass passwords or tokens in `detail`.
 */
export async function mailStub(
  stub: string,
  detail?: string,
): Promise<void> {
  const entry: MailTraceEntry = {
    at: Date.now(),
    seq: nextSeq++,
    stub,
    detail: truncateDetail(detail),
  };
  memory = [entry, ...memory].slice(0, TRACE_LIMIT);
  console.warn('[ebp-mail]', entry.seq, entry.stub, entry.detail ?? '');
  persistChain = persistChain
    .then(() => persistMemory())
    .catch(err => {
      console.warn('[ebp-mail] persist failed', err);
    });
  await persistChain;
}

export async function clearMailTrace(): Promise<void> {
  memory = [];
  nextSeq = 1;
  await AsyncStorage.removeItem(TRACE_KEY);
  console.warn('[ebp-mail]', 'trace cleared');
}

export async function listMailTrace(): Promise<MailTraceEntry[]> {
  if (memory.length > 0) {
    return [...memory];
  }
  const raw = await AsyncStorage.getItem(TRACE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as MailTraceEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    memory = parsed.slice(0, TRACE_LIMIT);
    const maxSeq = memory.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    nextSeq = maxSeq + 1;
    return [...memory];
  } catch {
    return [];
  }
}
