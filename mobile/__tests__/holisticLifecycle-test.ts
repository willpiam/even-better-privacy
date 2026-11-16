jest.mock('../src/services/settings', () => ({getAutoLockMinutes: jest.fn(async () => 15)}));
jest.mock('../src/services/mail/tcpClient', () => ({connectMailLineClient: jest.fn(),readTaggedOk: jest.fn(async () => [])}));
jest.mock('../src/services/mail/imap', () => ({imapAuthenticate: jest.fn()}));
jest.mock('../src/services/mail/smtp', () => ({expectSmtpReady: jest.fn(),smtpAuth: jest.fn()}));
jest.mock('../src/services/mail/mailTrace', () => ({mailStub: jest.fn(async () => {})}));
import {getAutoLockMinutes} from '../src/services/settings';
import {cacheUnlockedIdentity, isUnlocked, lock, lockAll} from '../src/services/unlockSession';
import {testMailConnection} from '../src/services/mail/mailTest';
import {connectMailLineClient} from '../src/services/mail/tcpClient';
import {imapAuthenticate} from '../src/services/mail/imap';
import {smtpAuth} from '../src/services/mail/smtp';
import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';

afterEach(() => {lockAll();jest.useRealTimers();jest.clearAllMocks();});

test.each(['all','identity'])('locking %s invalidates a pending unlock and wipes the rejected key', async kind => {
  let release!: (minutes:number) => void;
  jest.mocked(getAutoLockMinutes).mockImplementationOnce(() => new Promise(resolve => {release=resolve;}));
  const key=new Uint8Array([1,2,3]);
  const pending=cacheUnlockedIdentity('alice',key,new Uint8Array([4]));
  if(kind==='all')lockAll();else lock('alice');
  release(15);
  await expect(pending).rejects.toThrow('cancelled');
  expect(isUnlocked('alice')).toBe(false);
  expect(Array.from(key)).toEqual([0,0,0]);
});

test('mail test timeout closes its client and cannot continue into SMTP after late IMAP completion', async () => {
  jest.useFakeTimers();
  let finish!: () => void;
  const client={close:jest.fn(),writeLine:jest.fn(),readLine:jest.fn(),readBytes:jest.fn(),writeBytes:jest.fn()};
  jest.mocked(connectMailLineClient).mockResolvedValue(client);
  jest.mocked(imapAuthenticate).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  const pending=testMailConnection(DEFAULT_MAIL_ACCOUNT,{imapPassword:'imap',smtpPassword:'smtp'},{overallTimeoutMs:50});
  const rejected=expect(pending).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(51);
  await rejected;
  expect(client.close).toHaveBeenCalled();
  finish();
  await jest.advanceTimersByTimeAsync(0);
  expect(connectMailLineClient).toHaveBeenCalledTimes(1);
  expect(smtpAuth).not.toHaveBeenCalled();
  expect(client.writeLine).not.toHaveBeenCalled();
});
