import {decodeHeaderWords} from '../src/services/mail/headerWords';
import {parseHeaderField} from '../src/services/mail/imapFetchBody';

test('decodes Base64, Q encoding and adjacent folded encoded words', () => {
  expect(
    parseHeaderField('Subject: =?UTF-8?B?SGVsbG8g4piD?=\r\n\r\n', 'Subject'),
  ).toBe('Hello ☃');
  expect(decodeHeaderWords('=?UTF-8?Q?caf=C3=A9?= =?UTF-8?Q?_time?=')).toBe(
    'café time',
  );
  expect(decodeHeaderWords('=?ISO-8859-1?Q?caf=E9?=')).toBe('café');
  expect(
    parseHeaderField(
      'Subject: =?UTF-8?Q?one?=\r\n =?UTF-8?Q?_two?=\r\n\r\n',
      'Subject',
    ),
  ).toBe('one two');
});

test('preserves unsupported or malformed words and does not alter authentication addresses', () => {
  for (const value of [
    'plain header',
    '=?unknown?Q?test?=',
    '=?UTF-8?B?not-base64!?=',
    '=?UTF-8?Q?=ZZ?=',
    '=?UTF-8?Q?=0AX-Injected:_yes?=',
  ])
    expect(decodeHeaderWords(value)).toBe(value);
  const from = '=?UTF-8?Q?=3Cvictim=40example.test=3E?= <sender@example.test>';
  expect(parseHeaderField(`From: ${from}\r\n\r\n`, 'From')).toBe(from);
});
