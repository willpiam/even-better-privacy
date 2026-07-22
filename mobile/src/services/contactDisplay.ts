import type {
  ServerIdentitySummary,
  StoredContact,
} from './contacts';

export type ContactLike = {
  fingerprint: string;
  localAlias?: string;
  details?: Record<string, [string, string]>;
  resolvedOpaqueEmail?: string;
  /** Storage filename / import handle — search only, never display. */
  storageName?: string;
};

export type ContactLabels = {
  primary: string;
  secondary: string;
  condensedFingerprint: string;
};

function getDetailValue(
  details: Record<string, [string, string]> | undefined,
  path: string,
): string | null {
  if (!details) {
    return null;
  }
  const val = details[path];
  if (Array.isArray(val)) {
    return val[0] || null;
  }
  return typeof val === 'string' ? val : null;
}

/** First 12 + … + last 12; full string if shorter than 25 chars. */
export function condenseFingerprint(fp: string): string {
  if (fp.length < 25) {
    return fp;
  }
  return `${fp.slice(0, 12)}…${fp.slice(-12)}`;
}

function displayEmail(like: ContactLike): string | null {
  const published = getDetailValue(like.details, 'email')?.trim();
  if (published) {
    return published;
  }
  const opaque = like.resolvedOpaqueEmail?.trim();
  return opaque || null;
}

export function resolveContactLabels(like: ContactLike): ContactLabels {
  const condensedFingerprint = condenseFingerprint(like.fingerprint);
  const email = displayEmail(like);

  const alias = like.localAlias?.trim();
  const publishedName = getDetailValue(like.details, 'name')?.trim();

  let primary: string;
  let emailUsedAsPrimary = false;
  if (alias) {
    primary = alias;
  } else if (publishedName) {
    primary = publishedName;
  } else if (email) {
    primary = email;
    emailUsedAsPrimary = true;
  } else {
    primary = condensedFingerprint;
  }

  const secondary =
    email && !emailUsedAsPrimary ? email : condensedFingerprint;

  return {primary, secondary, condensedFingerprint};
}

export function contactSearchHaystack(like: ContactLike): string {
  const publishedName = getDetailValue(like.details, 'name') ?? '';
  const email = displayEmail(like) ?? '';
  return [
    like.localAlias ?? '',
    publishedName,
    email,
    like.resolvedOpaqueEmail ?? '',
    like.fingerprint,
    like.storageName ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function storedContactToLike(item: StoredContact): ContactLike {
  return {
    fingerprint: item.contact.fingerprint,
    localAlias: item.localAlias,
    details: item.contact.details,
    resolvedOpaqueEmail: item.contact.resolvedOpaqueDetails?.['opaque::email'],
    storageName: item.name,
  };
}

export function serverIdentityToLike(
  entry: ServerIdentitySummary,
): ContactLike {
  return {
    fingerprint: entry.fingerprint,
    details: entry.details,
  };
}
