import RNFS from 'react-native-fs';
import {KeyedQueue} from '../../../common/KeyedQueue.ts';
import {
  createVerificationOffer,
  endorsementId,
  MAX_ENDORSEMENT_BYTES,
  parseEndorsement,
  signEndorsement,
  signVerificationProof,
  VERIFIED_NAME_LIMIT,
  VERIFICATION_SESSION_MS,
  withdrawEndorsement,
  type EndorsementBundle,
  type VerificationOffer,
  type VerificationProof,
} from '../../../core/PeerVerification.ts';
import {Identity} from '../ebpCore';
import {writeFileAtomic} from './atomicFile';
import {importScannedContact, listContacts} from './contacts';
import {
  ensureAppDirs,
  getCertificatesDir,
  getCurrentIdentityRequired,
  loadIdentityForUse,
  readIdentityRaw,
} from './storage';

const updates = new KeyedQueue();
const fileSuffix = '.endorsement.json';

export type LocalVerification = {
  identityName: string;
  offer: VerificationOffer;
  startedAt: number;
};

export async function startPeerVerification(): Promise<LocalVerification> {
  const identityName = await getCurrentIdentityRequired();
  const publicData = Identity.readPublicData(
    await readIdentityRaw(identityName),
  );
  if (!publicData || publicData.revocationCertificate) {
    throw new Error('Select an active identity to start verification.');
  }
  return {
    identityName,
    offer: createVerificationOffer(
      publicData,
      identityName.slice(0, VERIFIED_NAME_LIMIT),
    ),
    startedAt: Date.now(),
  };
}

function requireFreshSession(local: LocalVerification): void {
  const elapsed = Date.now() - local.startedAt;
  if (elapsed < 0 || elapsed >= VERIFICATION_SESSION_MS) {
    throw new Error('This exchange expired. Start a new verification.');
  }
}

export async function createPeerProof(
  local: LocalVerification,
  peer: VerificationOffer,
) {
  requireFreshSession(local);
  const identity = await loadIdentityForUse(local.identityName);
  requireFreshSession(local);
  return signVerificationProof(identity, local.offer, peer);
}

export async function savePeerEndorsement(
  local: LocalVerification,
  peer: VerificationOffer,
  proof: VerificationProof,
  name: string,
): Promise<void> {
  requireFreshSession(local);
  const identity = await loadIdentityForUse(local.identityName);
  const contacts = await listContacts();
  if (
    contacts.some(
      item =>
        item.contact.fingerprint === peer.identity.fingerprint &&
        item.contact.revoked,
    )
  ) {
    throw new Error('This contact’s identity has been revoked.');
  }
  requireFreshSession(local);
  const bundle = signEndorsement(identity, local.offer, peer, proof, name);
  await importScannedContact(peer.identity, bundle.endorsement.name);
  await storeEndorsement(bundle);
}

function endorsementPath(bundle: EndorsementBundle): string {
  return `${getCertificatesDir()}/${bundle.subject.fingerprint}-${endorsementId(
    bundle.endorsement,
  )}${fileSuffix}`;
}

async function readEndorsement(path: string): Promise<EndorsementBundle> {
  if (Number((await RNFS.stat(path)).size) > MAX_ENDORSEMENT_BYTES) {
    throw new Error('The endorsement file is too large.');
  }
  return parseEndorsement(await RNFS.readFile(path, 'utf8'));
}

async function storeEndorsement(
  bundle: EndorsementBundle,
): Promise<EndorsementBundle> {
  await ensureAppDirs();
  const path = endorsementPath(bundle);
  return updates.run(path, async () => {
    if (await RNFS.exists(path)) {
      const existing = await readEndorsement(path);
      if (existing.withdrawal || !bundle.withdrawal) return existing;
    }
    await writeFileAtomic(path, JSON.stringify(bundle));
    return bundle;
  });
}

export async function importEndorsement(
  raw: string,
): Promise<EndorsementBundle> {
  return storeEndorsement(parseEndorsement(raw));
}

export async function listEndorsements(
  fingerprint?: string,
): Promise<EndorsementBundle[]> {
  await ensureAppDirs();
  const entries = await RNFS.readDir(getCertificatesDir());
  const bundles: EndorsementBundle[] = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(fileSuffix) ||
      (fingerprint && !entry.name.startsWith(fingerprint + '-'))
    )
      continue;
    try {
      const bundle = await readEndorsement(entry.path);
      if (entry.path === endorsementPath(bundle)) bundles.push(bundle);
    } catch {
      // A damaged record must never be displayed as a valid endorsement.
    }
  }
  return bundles.sort(
    (a, b) => b.endorsement.createdAt - a.endorsement.createdAt,
  );
}

export async function saveEndorsementWithdrawal(
  identityName: string,
  bundle: EndorsementBundle,
): Promise<void> {
  const identity = await loadIdentityForUse(identityName);
  await storeEndorsement(withdrawEndorsement(identity, bundle));
}
