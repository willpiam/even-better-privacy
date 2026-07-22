jest.mock('../src/services/contacts', () => ({
  fetchContactFromServer: jest.fn(),
  listContacts: jest.fn(),
  loadContact: jest.fn(),
}));

import {buildSimpleMimeMessage, buildMultipartMimeMessage} from '../src/services/mail/mime';
import {
  formatQuotedBody,
  formatReplySubject,
  parseMessageId,
} from '../src/services/mail/mailReply';

describe('mailReply helpers', () => {
  test('formatReplySubject prefixes Re: once', () => {
    expect(formatReplySubject('Hello')).toBe('Re: Hello');
    expect(formatReplySubject('Re: Hello')).toBe('Re: Hello');
    expect(formatReplySubject('re: already')).toBe('re: already');
    expect(formatReplySubject('')).toBe('Re: (no subject)');
  });

  test('formatQuotedBody quotes lines', () => {
    const out = formatQuotedBody({
      from: 'Alice <a@example.com>',
      date: 'Tue, 21 Jul 2026 12:00:00 +0000',
      body: 'Line one\nLine two',
    });
    expect(out).toContain('On Tue, 21 Jul 2026 12:00:00 +0000, Alice <a@example.com> wrote:');
    expect(out).toContain('> Line one');
    expect(out).toContain('> Line two');
  });

  test('parseMessageId reads Message-ID header only', () => {
    const source = [
      'From: a@example.com',
      'Message-ID: <abc@example.com>',
      'Subject: Hi',
      '',
      'Message-ID: <fake-in-body@example.com>',
      'Body text',
    ].join('\r\n');
    expect(parseMessageId(source)).toBe('<abc@example.com>');
  });
});

describe('MIME threading headers', () => {
  test('buildSimpleMimeMessage emits In-Reply-To and References', () => {
    const mime = buildSimpleMimeMessage({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Re: Hi',
      body: 'hello',
      inReplyTo: '<abc@example.com>',
      references: '<abc@example.com>',
    });
    expect(mime).toContain('In-Reply-To: <abc@example.com>');
    expect(mime).toContain('References: <abc@example.com>');
  });

  test('buildMultipartMimeMessage emits threading headers', () => {
    const mime = buildMultipartMimeMessage({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Re: Hi',
      plainBody: 'hint',
      ebpArmor: '-----BEGIN EBP MESSAGE-----\n{}\n-----END EBP MESSAGE-----',
      inReplyTo: '<xyz@example.com>',
      references: '<xyz@example.com>',
    });
    expect(mime).toContain('In-Reply-To: <xyz@example.com>');
    expect(mime).toContain('References: <xyz@example.com>');
  });

  test('omits threading headers when absent', () => {
    const mime = buildSimpleMimeMessage({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Hi',
      body: 'hello',
    });
    expect(mime).not.toContain('In-Reply-To:');
    expect(mime).not.toContain('References:');
  });
});
