import {
  clearMailTrace,
  isMailTraceEnabled,
  listMailTrace,
  mailStub,
  setMailTraceEnabled,
} from '../src/services/mail/mailTrace';

const originalDev = __DEV__;

beforeEach(async () => {
  Object.assign(globalThis, {__DEV__: true});
  setMailTraceEnabled(false);
  await clearMailTrace();
});
afterEach(() => {
  Object.assign(globalThis, {__DEV__: originalDev});
});

it('records nothing until a developer opts in', async () => {
  await mailStub('imap.login.wait');
  expect(await listMailTrace()).toEqual([]);
  setMailTraceEnabled(true);
  expect(isMailTraceEnabled()).toBe(true);
  await mailStub('imap.login.ok');
  expect((await listMailTrace()).map(entry => entry.stub)).toEqual([
    'imap.login.ok',
  ]);
  setMailTraceEnabled(false);
  await mailStub('ignored');
  expect(await listMailTrace()).toHaveLength(1);
});

it('bounds session memory and details, and clears the trace', async () => {
  setMailTraceEnabled(true);
  await Promise.all(
    Array.from({length: 250}, (_, i) => mailStub(`step-${i}`, 'a'.repeat(500))),
  );
  const entries = await listMailTrace();
  expect(entries).toHaveLength(200);
  expect(entries[0].stub).toBe('step-249');
  expect(entries[199].stub).toBe('step-50');
  expect(entries[0].detail).toHaveLength(240);
  await clearMailTrace();
  expect(await listMailTrace()).toEqual([]);
});

it('cannot record or expose traces in release even after a prior debug opt-in', async () => {
  setMailTraceEnabled(true);
  await mailStub('debug-only');
  Object.assign(globalThis, {__DEV__: false});
  setMailTraceEnabled(true);
  expect(isMailTraceEnabled()).toBe(false);
  await mailStub('release');
  expect(await listMailTrace()).toEqual([]);
});
