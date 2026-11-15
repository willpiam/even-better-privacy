export type MailTraceEntry = {
  at: number;
  seq: number;
  stub: string;
  detail?: string;
};

const TRACE_LIMIT = 200;
let enabled = false;
let memory: MailTraceEntry[] = [];
let nextSeq = 1;

export function isMailTraceEnabled(): boolean {
  return __DEV__ && enabled;
}

/** Opt-in, development-only tracing. Nothing is persisted to device storage. */
export function setMailTraceEnabled(value: boolean): void {
  enabled = __DEV__ && value;
}

/** Never pass passwords or tokens in detail. Awaiting this never waits for I/O. */
export async function mailStub(stub: string, detail?: string): Promise<void> {
  if (!__DEV__ || !enabled) {
    return;
  }
  const entry: MailTraceEntry = {
    at: Date.now(),
    seq: nextSeq++,
    stub,
    detail: detail
      ? detail.length > 240
        ? `${detail.slice(0, 237)}...`
        : detail
      : undefined,
  };
  memory = [entry, ...memory].slice(0, TRACE_LIMIT);
}

export async function clearMailTrace(): Promise<void> {
  memory = [];
  nextSeq = 1;
}

export async function listMailTrace(): Promise<MailTraceEntry[]> {
  return __DEV__ ? [...memory] : [];
}
