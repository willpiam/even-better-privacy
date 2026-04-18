import { LIMITS } from "../body.ts";
import { json } from "../response.ts";
import {
  getIdentity,
  getRevokedDetailPaths,
  isIdentityRevoked,
} from "../db.ts";
import type { DatabaseAdapter } from "../db.ts";

export const DEFAULT_PAGE_SIZE = 5;

export function coerceNumber(value: number | string | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}

export async function handleListIdentities(url: URL, db: DatabaseAdapter): Promise<Response> {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  const countQuery = includeRevoked
    ? "SELECT COUNT(*) FROM identities"
    : "SELECT COUNT(*) FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";
  const totalCountRows = await db.query<[number | string | bigint]>(countQuery);
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  const listQuery = includeRevoked
    ? "SELECT fingerprint, signing_key_type, encryption_key_type, created_at FROM identities ORDER BY created_at ASC LIMIT ? OFFSET ?"
    : "SELECT fingerprint, signing_key_type, encryption_key_type, created_at FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity') ORDER BY created_at ASC LIMIT ? OFFSET ?";
  const identityRows = await db.query<[string, string, string, number | string | bigint]>(listQuery, [limit, offset]);

  const fingerprints: string[] = [];
  const rows: Array<{
    fingerprint: string;
    signingKeyType: string;
    encryptionKeyType: string;
    createdAt: number;
    details: Record<string, [string, string]>;
    detailsMeta: Record<string, { verified: boolean; verifiedAt: number | null }>;
    revoked: boolean;
    revokedDetails: string[];
    revocationCertificate?: string | null;
  }> = [];
  
  for (const [fp, skt, ekt, createdAt] of identityRows) {
    const createdAtNumber = coerceNumber(createdAt) ?? 0;
    fingerprints.push(fp);
    rows.push({
      fingerprint: fp,
      signingKeyType: skt,
      encryptionKeyType: ekt,
      createdAt: createdAtNumber,
      details: {},
      detailsMeta: {},
      revoked: false,
      revokedDetails: [],
      revocationCertificate: null,
    });
  }

  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    const detailRows = await db.query<[string, string, string, string, number | string | bigint | null]>(
      `SELECT identity_fingerprint, path, detail, proof, verified_at FROM details WHERE identity_fingerprint IN (${placeholders}) ORDER BY id ASC`,
      fingerprints,
    );
    
    const detailsByFp: Record<string, Record<string, [string, string]>> = {};
    const detailsMetaByFp: Record<string, Record<string, { verified: boolean; verifiedAt: number | null }>> = {};
    for (const [identityFp, path, detail, proof, verified_at] of detailRows) {
      if (!detailsByFp[identityFp]) {
        detailsByFp[identityFp] = {};
      }
      if (!detailsMetaByFp[identityFp]) {
        detailsMetaByFp[identityFp] = {};
      }
      detailsByFp[identityFp][path] = [detail, proof];
      const verifiedAt = coerceNumber(verified_at);
      detailsMetaByFp[identityFp][path] = { verified: verifiedAt !== null, verifiedAt };
    }

    for (const row of rows) {
      row.details = detailsByFp[row.fingerprint] ?? {};
      row.detailsMeta = detailsMetaByFp[row.fingerprint] ?? {};
    }

    for (const row of rows) {
      const revokedDetails = await getRevokedDetailPaths(db, row.fingerprint);
      row.revokedDetails = revokedDetails;
      for (const path of revokedDetails) {
        delete row.details[path];
        delete row.detailsMeta[path];
      }

      const revoked = await isIdentityRevoked(db, row.fingerprint);
      row.revoked = revoked;
      if (revoked) {
        const identityRow = await getIdentity(db, row.fingerprint);
        row.revocationCertificate = identityRow?.revocation_certificate ?? null;
      }
    }
  }

  const totalPages = Math.ceil(totalCount / limit);

  return json({
    identities: rows,
    pagination: {
      page,
      pageSize: limit,
      total: totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
}

export async function handleSearchIdentities(url: URL, db: DatabaseAdapter): Promise<Response> {
  const rawQuery = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  if (rawQuery.length > LIMITS.searchQuery) {
    return json({ error: `search query too long (max ${LIMITS.searchQuery} characters)` }, 400);
  }

  if (!rawQuery) {
    return json({
      identities: [],
      pagination: {
        page,
        pageSize: limit,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
    });
  }

  const like = `%${rawQuery}%`;

  const baseJoin =
    "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email')";
  const matchClause = "(LOWER(i.fingerprint) LIKE ? OR LOWER(d.detail) LIKE ?)";
  const revokedFilter = includeRevoked
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

  const countQuery = `SELECT COUNT(DISTINCT i.fingerprint) ${baseJoin} WHERE ${matchClause} ${revokedFilter}`;
  const totalCountRows = await db.query<[number | string | bigint]>(countQuery, [like, like]);
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  const listQuery =
    `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at ` +
    `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT ? OFFSET ?`;
  const identityRows = await db.query<[string, string, string, number | string | bigint]>(listQuery, [like, like, limit, offset]);

  const fingerprints: string[] = [];
  const rows: Array<{
    fingerprint: string;
    signingKeyType: string;
    encryptionKeyType: string;
    createdAt: number;
    details: Record<string, [string, string]>;
    detailsMeta: Record<string, { verified: boolean; verifiedAt: number | null }>;
    revoked: boolean;
    revokedDetails: string[];
    revocationCertificate?: string | null;
  }> = [];

  for (const [fp, skt, ekt, createdAt] of identityRows) {
    const createdAtNumber = coerceNumber(createdAt) ?? 0;
    fingerprints.push(fp);
    rows.push({
      fingerprint: fp,
      signingKeyType: skt,
      encryptionKeyType: ekt,
      createdAt: createdAtNumber,
      details: {},
      detailsMeta: {},
      revoked: false,
      revokedDetails: [],
      revocationCertificate: null,
    });
  }

  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    const detailRows = await db.query<[string, string, string, string, number | string | bigint | null]>(
      `SELECT identity_fingerprint, path, detail, proof, verified_at FROM details WHERE identity_fingerprint IN (${placeholders}) ORDER BY id ASC`,
      fingerprints,
    );

    const detailsByFp: Record<string, Record<string, [string, string]>> = {};
    const detailsMetaByFp: Record<string, Record<string, { verified: boolean; verifiedAt: number | null }>> = {};
    for (const [identityFp, path, detail, proof, verified_at] of detailRows) {
      if (!detailsByFp[identityFp]) {
        detailsByFp[identityFp] = {};
      }
      if (!detailsMetaByFp[identityFp]) {
        detailsMetaByFp[identityFp] = {};
      }
      detailsByFp[identityFp][path] = [detail, proof];
      const verifiedAt = coerceNumber(verified_at);
      detailsMetaByFp[identityFp][path] = { verified: verifiedAt !== null, verifiedAt };
    }

    for (const row of rows) {
      row.details = detailsByFp[row.fingerprint] ?? {};
      row.detailsMeta = detailsMetaByFp[row.fingerprint] ?? {};
    }

    for (const row of rows) {
      const revokedDetails = await getRevokedDetailPaths(db, row.fingerprint);
      row.revokedDetails = revokedDetails;
      for (const path of revokedDetails) {
        delete row.details[path];
        delete row.detailsMeta[path];
      }

      const revoked = await isIdentityRevoked(db, row.fingerprint);
      row.revoked = revoked;
      if (revoked) {
        const identityRow = await getIdentity(db, row.fingerprint);
        row.revocationCertificate = identityRow?.revocation_certificate ?? null;
      }
    }
  }

  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

  return json({
    identities: rows,
    pagination: {
      page,
      pageSize: limit,
      total: totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
}
