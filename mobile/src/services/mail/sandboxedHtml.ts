/**
 * Sandboxed HTML wrapper for plain (non-EBP) mail preview.
 * Mirrors gui/js/mail.js buildSandboxedEmailSrcDoc.
 */
export function buildSandboxedEmailSrcDoc(html: string): string {
  const csp =
    "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;";
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    '<style>html,body{margin:0;padding:12px;font-family:system-ui,-apple-system,sans-serif;color:#111;line-height:1.4;word-break:break-word;}img{max-width:100%;height:auto;}pre{white-space:pre-wrap;overflow-wrap:anywhere;}table{max-width:100%;}</style>',
    '</head>',
    `<body>${html || ''}</body>`,
    '</html>',
  ].join('');
}
