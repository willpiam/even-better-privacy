import bundle from './mailCryptoBundle';
import type {MailCryptoInput} from './mailCryptoTypes';

export const cryptoSource = {
  baseUrl: 'https://localhost/',
  html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';"><script>${bundle.replace(
    /<\/script/gi,
    '<\\/script',
  )}</script>`,
};
export function cryptoScript(input: MailCryptoInput): string {
  return `window.encryptMail(${JSON.stringify(input)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}); true;`;
}
