/**
 * Sandboxed HTML wrapper for plain (non-EBP) mail preview.
 * The nested frame also disables automatic navigation, forms and popups.
 */
export function buildSandboxedEmailSrcDoc(html: string): string {
  const csp =
    "default-src 'none'; frame-src about:; img-src data: cid:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none';";
  const content = [
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
  const srcDoc = content
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;height:100%;}iframe{border:0;width:100%;height:100%;}</style></head><body><iframe title="Email content" sandbox="" srcdoc="${srcDoc}"></iframe></body></html>`;
}

/** WebViews must never navigate from a mail preview to a sender-chosen URL. */
export function isAllowedMailPreviewNavigation(url: string): boolean {
  const documentUrl = url.split('#', 1)[0];
  return documentUrl === 'about:blank' || documentUrl === 'about:srcdoc';
}
