import RNFS from 'react-native-fs';
import {
  createHierarchyCertificate,
  decodeHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  hexToString,
  stableStringify,
  stringToHex,
  type SignedHierarchyCertificate,
} from '../ebpCore';
import {
  buildHierarchyTreeFromCertificates,
  decodeCertsFromStored,
} from './hierarchyTree';
import {
  filterPendingForIdentity,
  mergePendingProposals,
  pendingPairKey,
  type PendingHierarchyProposal,
} from './hierarchyPending';
import {getServerUrl} from './settings';
import {
  ensureAppDirs,
  getCertificatesDir,
  getPendingCertificatesFile,
  loadIdentity,
} from './storage';

export type {PendingHierarchyProposal};

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readPendingLocal(): Promise<PendingHierarchyProposal[]> {
  await ensureAppDirs();
  const file = getPendingCertificatesFile();
  if (!(await RNFS.exists(file))) {
    return [];
  }
  const raw = await RNFS.readFile(file, 'utf8');
  try {
    const parsed = JSON.parse(raw) as PendingHierarchyProposal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePendingLocal(items: PendingHierarchyProposal[]): Promise<void> {
  await ensureAppDirs();
  await RNFS.writeFile(
    getPendingCertificatesFile(),
    JSON.stringify(items, null, 2),
    'utf8',
  );
}

async function storeActiveCertificate(certificate: string): Promise<void> {
  await ensureAppDirs();
  const id = Date.now();
  await RNFS.writeFile(
    `${getCertificatesDir()}/${id}.certificate.json`,
    JSON.stringify({certificate}, null, 2),
    'utf8',
  );
}

export async function listCertificates(): Promise<
  Array<{
    certificate: string;
    masterFingerprint: string;
    childFingerprint: string;
    timestamp: number;
    expiry: number;
    context: string;
  }>
> {
  await ensureAppDirs();
  const entries = await RNFS.readDir(getCertificatesDir());
  const out: Array<{
    certificate: string;
    masterFingerprint: string;
    childFingerprint: string;
    timestamp: number;
    expiry: number;
    context: string;
  }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.certificate.json')) {
      continue;
    }
    const raw = await RNFS.readFile(entry.path, 'utf8');
    const obj = JSON.parse(raw) as {certificate?: string};
    if (!obj.certificate) {
      continue;
    }
    const cert = decodeHierarchyCertificate(obj.certificate);
    if (!cert) {
      continue;
    }
    out.push({
      certificate: obj.certificate,
      masterFingerprint: cert.masterFingerprint,
      childFingerprint: cert.childFingerprint,
      timestamp: cert.timestamp,
      expiry: cert.expiry,
      context: cert.context,
    });
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

export async function proposeHierarchy(params: {
  identityName: string;
  password: string;
  masterFingerprint: string;
  childFingerprint: string;
  context?: string;
  expiry?: number;
  server?: string;
}): Promise<PendingHierarchyProposal> {
  const identity = await loadIdentity(params.identityName, params.password);
  const proposerFingerprint = identity.toFingerprint();
  const cert = createHierarchyCertificate(
    params.masterFingerprint,
    params.childFingerprint,
    {
      context: params.context ?? '',
      expiry: params.expiry ?? 0,
    },
  );
  const payload = getHierarchySignaturePayload(cert);
  const signature = identity.signMessage(payload, undefined, 'hierarchy');
  if (proposerFingerprint === cert.masterFingerprint) {
    cert.masterSignature = signature;
  } else if (proposerFingerprint === cert.childFingerprint) {
    cert.childSignature = signature;
  } else {
    throw new Error('Current identity must be either master or child');
  }
  const encoded = stringToHex(JSON.stringify(cert));
  const pending = await readPendingLocal();
  const proposal: PendingHierarchyProposal = {
    id: pending.length ? Math.max(...pending.map(x => x.id)) + 1 : 1,
    masterFingerprint: cert.masterFingerprint,
    childFingerprint: cert.childFingerprint,
    proposerFingerprint,
    certificate: encoded,
    context: cert.context,
    expiry: cert.expiry,
    createdAt: Date.now(),
    source: 'local',
  };

  const server = params.server ?? (await getServerUrl());
  let serverError: Error | null = null;
  try {
    const res = await fetch(apiUrl(server, '/api/v1/hierarchy/propose'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        proposerFingerprint,
        certificate: encoded,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      proposal?: {id?: number; createdAt?: number};
    };
    if (!res.ok) {
      serverError = new Error(
        body.error ?? `Failed to propose hierarchy on server (HTTP ${res.status})`,
      );
    } else {
      if (typeof body.proposal?.id === 'number') {
        proposal.id = body.proposal.id;
        proposal.source = 'server';
      }
      if (typeof body.proposal?.createdAt === 'number') {
        proposal.createdAt = body.proposal.createdAt;
      }
    }
  } catch {
    // Offline / network failure: keep local-only proposal.
  }
  await writePendingLocal([...pending, proposal]);
  if (serverError) {
    throw serverError;
  }
  return proposal;
}

async function fetchServerPending(
  fingerprint: string,
  server: string,
): Promise<PendingHierarchyProposal[]> {
  const res = await fetch(
    apiUrl(server, `/api/v1/hierarchy/pending/${encodeURIComponent(fingerprint)}`),
  );
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    proposals?: Array<{
      id: number;
      masterFingerprint: string;
      childFingerprint: string;
      proposerFingerprint: string;
      certificate: string;
      context: string;
      expiry: number;
      createdAt: number;
    }>;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (body.proposals ?? []).map(p => ({
    ...p,
    source: 'server' as const,
  }));
}

export async function listPending(
  identityFingerprint?: string,
  server?: string,
): Promise<PendingHierarchyProposal[]> {
  const local = await readPendingLocal();
  let serverItems: PendingHierarchyProposal[] = [];
  if (identityFingerprint) {
    try {
      serverItems = await fetchServerPending(
        identityFingerprint,
        server ?? (await getServerUrl()),
      );
    } catch {
      // Offline or identity not published: fall back to local-only.
    }
  }
  const merged = mergePendingProposals(local, serverItems);
  if (!identityFingerprint) {
    return merged;
  }
  return filterPendingForIdentity(merged, identityFingerprint);
}

export async function acceptProposal(params: {
  identityName: string;
  password: string;
  proposalId: number;
  server?: string;
}): Promise<void> {
  const identity = await loadIdentity(params.identityName, params.password);
  const myFingerprint = identity.toFingerprint();
  const pending = await listPending(myFingerprint, params.server);
  const proposal = pending.find(p => p.id === params.proposalId);
  if (!proposal) {
    throw new Error('Pending proposal not found');
  }
  if (proposal.proposerFingerprint === myFingerprint) {
    throw new Error('Proposer cannot accept their own pending entry');
  }
  const certDraft = JSON.parse(hexToString(proposal.certificate)) as Record<
    string,
    unknown
  >;
  const payload = getHierarchySignaturePayload(certDraft as never);
  const sig = identity.signMessage(payload, undefined, 'hierarchy');
  if (myFingerprint === certDraft.masterFingerprint) {
    certDraft.masterSignature = sig;
  } else if (myFingerprint === certDraft.childFingerprint) {
    certDraft.childSignature = sig;
  } else {
    throw new Error('Current identity is not part of this proposal');
  }
  const signed = encodeHierarchyCertificate(certDraft as never);
  if (!decodeHierarchyCertificate(signed)) {
    throw new Error('Accepted certificate must include both signatures');
  }

  const server = params.server ?? (await getServerUrl());
  const useAcceptEndpoint = proposal.source === 'server';
  const res = await fetch(
    apiUrl(
      server,
      useAcceptEndpoint ? '/api/v1/hierarchy/accept' : '/api/v1/hierarchy',
    ),
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(
        useAcceptEndpoint
          ? {proposalId: proposal.id, certificate: signed}
          : {certificate: signed},
      ),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(
      `Failed to publish accepted hierarchy certificate: ${body.error ?? `HTTP ${res.status}`}`,
    );
  }
  const local = await readPendingLocal();
  const pair = pendingPairKey(proposal);
  await writePendingLocal(local.filter(p => pendingPairKey(p) !== pair));
  await storeActiveCertificate(signed);
}

export async function rejectProposal(params: {
  proposalId: number;
  identityName: string;
  password: string;
  server?: string;
}): Promise<void> {
  const identity = await loadIdentity(params.identityName, params.password);
  const rejectorFingerprint = identity.toFingerprint();
  const pending = await listPending(rejectorFingerprint, params.server);
  const proposal = pending.find(p => p.id === params.proposalId);
  if (!proposal) {
    throw new Error('Pending proposal not found');
  }
  if (proposal.proposerFingerprint === rejectorFingerprint) {
    throw new Error('Proposer cannot reject their own pending entry');
  }

  const local = await readPendingLocal();
  const pair = pendingPairKey(proposal);
  await writePendingLocal(local.filter(p => pendingPairKey(p) !== pair));

  if (proposal.source !== 'server') {
    return;
  }

  const server = params.server ?? (await getServerUrl());
  const timestamp = Date.now();
  const rejectMessage = stableStringify({
    action: 'hierarchy::reject',
    fingerprint: rejectorFingerprint,
    proposalId: proposal.id,
    timestamp,
  });
  const signature = identity.signMessage(rejectMessage);
  try {
    const res = await fetch(apiUrl(server, '/api/v1/hierarchy/reject'), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        proposalId: proposal.id,
        fingerprint: rejectorFingerprint,
        timestamp,
        signature,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {error?: string};
      throw new Error(
        body.error ?? `Failed to reject hierarchy proposal (HTTP ${res.status})`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Failed to reject')) {
      throw error;
    }
    // Local reject still succeeds if network notify fails.
  }
}

export async function publishCertificate(params: {
  certificate: string;
  server?: string;
}): Promise<void> {
  if (!decodeHierarchyCertificate(params.certificate)) {
    throw new Error('Certificate must include both signatures');
  }
  const server = params.server ?? (await getServerUrl());
  const res = await fetch(apiUrl(server, '/api/v1/hierarchy'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({certificate: params.certificate}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(`Failed to publish hierarchy certificate: ${body.error ?? `HTTP ${res.status}`}`);
  }
  await storeActiveCertificate(params.certificate);
}

async function fetchServerHierarchyCerts(
  fingerprint: string,
  server: string,
): Promise<SignedHierarchyCertificate[]> {
  const url = new URL(
    apiUrl(server, `/api/v1/hierarchy/${encodeURIComponent(fingerprint)}`),
  );
  url.searchParams.set('source', 'server');
  const res = await fetch(url.toString());
  const body = (await res.json().catch(() => ({}))) as {
    relationships?: Array<{certificate?: string}>;
  };
  if (!res.ok) {
    const reason = (body as {error?: string}).error ?? `HTTP ${res.status}`;
    throw new Error(`Failed to fetch hierarchy tree: ${reason}`);
  }
  const certs: SignedHierarchyCertificate[] = [];
  for (const rel of body.relationships ?? []) {
    if (!rel.certificate) {
      continue;
    }
    const decoded = decodeHierarchyCertificate(rel.certificate);
    if (decoded) {
      certs.push(decoded);
    }
  }
  return certs;
}

export async function getMergedHierarchyTree(
  fingerprint: string,
  server?: string,
): Promise<ReturnType<typeof buildHierarchyTreeFromCertificates>> {
  const localStored = await listCertificates();
  const localDecoded = decodeCertsFromStored(localStored);
  let serverDecoded: SignedHierarchyCertificate[] = [];
  try {
    serverDecoded = await fetchServerHierarchyCerts(
      fingerprint,
      server ?? (await getServerUrl()),
    );
  } catch {
    // Use local-only tree when server is unreachable.
  }
  const byEdge = new Map<string, SignedHierarchyCertificate>();
  for (const cert of [...localDecoded, ...serverDecoded]) {
    byEdge.set(`${cert.masterFingerprint}:${cert.childFingerprint}`, cert);
  }
  return buildHierarchyTreeFromCertificates(
    fingerprint,
    Array.from(byEdge.values()),
  );
}

export async function getHierarchyTree(fingerprint: string, server?: string): Promise<unknown> {
  return getMergedHierarchyTree(fingerprint, server);
}
