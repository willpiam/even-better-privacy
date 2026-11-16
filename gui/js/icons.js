// Local, shared line icons. No font or remote asset requests are needed.
const paths = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  identities: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8 17c0-4 8-4 8 0"/>',
  contacts: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  tools: '<path d="m14.5 6.5 3 3M3 21l6-6m-4 0 4 4M14 3a6 6 0 0 0-5 9L3 18l3 3 6-6a6 6 0 0 0 9-5l-4 3-4-4 3-4-2-2Z"/>',
  certificate: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6m2-20 6 6h-6V2M8 8h2m-2 4h4"/><circle cx="17" cy="16" r="3"/><path d="m15 19-1 4 3-1 3 1-1-4"/>',
  settings: '<path d="m10 3-.6 2.1-2 .9-2-.5-2 3.5 1.5 1.6v2.8L3.4 15l2 3.5 2-.5 2 .9.6 2.1h4l.6-2.1 2-.9 2 .5 2-3.5-1.5-1.6v-2.8l1.5-1.6-2-3.5-2 .5-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  shield: '<path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  sign: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5M3 7V3h4"/>',
  verify: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5m-13-10 2 2 4-4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h6"/>',
  fingerprint: '<path d="M5 12a7 7 0 0 1 14 0m-11 0a4 4 0 0 1 8 0v3m-5-3v5m-6-2v2m3-2v5m6-2v3m4-3v2M3 9a10 10 0 0 1 18 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13 2M4.9 16a8 8 0 0 0 13 2"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.shield}</svg>`;
}

export function initials(name) {
  return String(name || "").trim().split(/[\s._@-]+/).filter(Boolean)
    .slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase() || "E";
}
