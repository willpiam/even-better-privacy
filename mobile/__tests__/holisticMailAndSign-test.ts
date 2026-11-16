jest.mock('react-native-tcp-socket', () => ({}));
jest.mock('react-native-fs', () => ({readFile: jest.fn()}));
jest.mock('../src/services/storage', () => ({}));
jest.mock('../src/services/contacts', () => ({loadContact:jest.fn()}));
jest.mock('../src/services/mail/mailTrace', () => ({mailStub:jest.fn(async () => {})}));
import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import {Identity} from '../../core/Identity';
import {verifyFileSignature} from '../src/services/signVerify';
import {signFileBytesWithIdentity} from '../src/services/signVerifyLogic';
import {buildSimpleMimeMessage, parseMimeMessage} from '../src/services/mail/mime';
import {formatFromHeader} from '../src/services/mail/ebpMailLogic';
import {decodeHeaderWords} from '../src/services/mail/headerWords';
import {readTaggedOk} from '../src/services/mail/tcpClient';
import {parseImapListLine} from '../../common/SentMailbox';
import {buildUidSearchCommand} from '../src/services/mail/imap';

test('actual mobile signed-file verifier binds outer and embedded fingerprints to the keys', async () => {
  const identity=new Identity('dilithium','kyber');
  const fileBytes=Buffer.from('signed file');
  jest.mocked(RNFS.readFile).mockResolvedValue(fileBytes.toString('base64'));
  const {payload}=signFileBytesWithIdentity({identity,fileBytes,fileName:'signed.txt',contextMessage:'context',includeSalt:false});
  expect((await verifyFileSignature({fileUri:'/signed.txt',payload})).verified).toBe(true);
  await expect(verifyFileSignature({fileUri:'/signed.txt',payload:{...payload,fingerprint:'attacker'}})).rejects.toThrow('Invalid signed file');
  await expect(verifyFileSignature({fileUri:'/signed.txt',payload:{...payload,identity:{...identity.summary,fingerprint:'attacker'}}})).rejects.toThrow('Invalid signed file');
  await expect(verifyFileSignature({fileUri:'/signed.txt',payload:{...payload,salt:'::context',contextMessage:''}})).rejects.toThrow('hexadecimal');
});

test('Unicode MIME uses encoded headers and transfer encoding on servers with basic SMTP support', () => {
  const mime=buildSimpleMimeMessage({from:formatFromHeader('Doe, Jane','jane@example.test'),to:'Bob <bob@example.test>',subject:'雪 and café',body:'café 😀'});
  expect(mime).not.toMatch(/[^\x00-\x7f]/);
  expect(mime).toContain('From: "Doe, Jane" <jane@example.test>');
  const subject=mime.match(/^Subject: (.*)$/m)![1];
  expect(decodeHeaderWords(subject.trim())).toBe('雪 and café');
  expect(parseMimeMessage(mime).text).toBe('café 😀');
});

test('IMAP LIST literal data belongs to its response and status atoms cannot be inferred from prose', async () => {
  const lines=['* LIST (\\Sent) "/" {4}','','s1 OK done'];
  const client={readLine:jest.fn(async () => lines.shift()!),readBytes:jest.fn(async () => Buffer.from('Sent')),writeLine:jest.fn(),writeBytes:jest.fn(),close:jest.fn()};
  const result=await readTaggedOk(client,'s1');
  expect(result.map(parseImapListLine).filter(Boolean)).toEqual([{path:'Sent',flags:['\\Sent']}]);
  const failed={...client,readLine:jest.fn(async () => 's1 NO server says OK later')};
  await expect(readTaggedOk(failed,'s1')).rejects.toThrow('s1 NO');
  expect(buildUidSearchCommand('s2','café')).toBe('s2 UID SEARCH CHARSET UTF-8 TEXT "café"');
});
