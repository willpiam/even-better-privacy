import { LIMITS } from "../body.ts";
import { json } from "../response.ts";
import { escapeLikePattern } from "../db/index.ts";
import type { DatabaseAdapter } from "../db/index.ts";

export const DEFAULT_PAGE_SIZE = 5;

export function coerceNumber(
  value: number | string | bigint | null,
): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}

type DbNumber = number | string | bigint;
type IdentitySummaryRow = [
  string,
  string,
  string,
  DbNumber,
  DbNumber | null,
  string | null,
];

type IdentitySummary = {
  fingerprint: string;
  signingKeyType: string;
  encryptionKeyType: string;
  createdAt: number;
  details: Record<string, [string, string]>;
  detailsMeta: Record<string, { verified: boolean; verifiedAt: number | null }>;
  revoked: boolean;
  revokedDetails: string[];
  revocationCertificate: string | null;
};

/** Hydrate a whole page with one detail query, including revocation metadata. */
async function hydrateIdentitySummaries(
  db: DatabaseAdapter,
  identityRows: IdentitySummaryRow[],
): Promise<IdentitySummary[]> {
  const rows = identityRows.map(
    (
      [
        fingerprint,
        signingKeyType,
        encryptionKeyType,
        createdAt,
        revokedAt,
        certificate,
      ],
    ): IdentitySummary => {
      const revoked = coerceNumber(revokedAt) !== null;
      return {
        fingerprint,
        signingKeyType,
        encryptionKeyType,
        createdAt: coerceNumber(createdAt) ?? 0,
        details: {},
        detailsMeta: {},
        revoked,
        revokedDetails: [],
        revocationCertificate: revoked ? certificate : null,
      };
    },
  );
  if (rows.length === 0) return rows;

  const byFingerprint = new Map(rows.map((row) => [row.fingerprint, row]));
  const fingerprints = rows.map((row) => row.fingerprint);
  const placeholders = fingerprints.map(() => "?").join(",");
  const details = await db.query<
    [string, string, string, string, DbNumber | null, DbNumber | null]
  >(
    `SELECT identity_fingerprint, path, detail, proof, CAST(verified_at AS TEXT), CAST(revoked_at AS TEXT)
     FROM details WHERE identity_fingerprint IN (${placeholders}) ORDER BY id ASC`,
    fingerprints,
  );
  for (
    const [fingerprint, path, detail, proof, verifiedAtRaw, revokedAt]
      of details
  ) {
    const row = byFingerprint.get(fingerprint)!;
    if (coerceNumber(revokedAt) !== null) {
      row.revokedDetails.push(path);
      continue;
    }
    const verifiedAt = coerceNumber(verifiedAtRaw);
    // Detail paths are user-defined, including names such as "__proto__".
    Object.defineProperty(row.details, path, {
      value: [detail, proof],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(row.detailsMeta, path, {
      value: { verified: verifiedAt !== null, verifiedAt },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return rows;
}

export async function handleListIdentities(
  url: URL,
  db: DatabaseAdapter,
): Promise<Response> {
  const page = Math.max(
    1,
    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  const limit = Math.max(
    1,
    Math.min(
      100,
      parseInt(
        url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE),
        10,
      ) || DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  const countQuery = includeRevoked
    ? "SELECT COUNT(*) FROM identities"
    : "SELECT COUNT(*) FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";
  const totalCountRows = await db.query<[number | string | bigint]>(countQuery);
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  const listQuery = includeRevoked
    ? "SELECT fingerprint, signing_key_type, encryption_key_type, created_at, CAST(revoked_at AS TEXT), revocation_certificate FROM identities ORDER BY created_at ASC LIMIT ? OFFSET ?"
    : "SELECT fingerprint, signing_key_type, encryption_key_type, created_at, CAST(revoked_at AS TEXT), revocation_certificate FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity') ORDER BY created_at ASC LIMIT ? OFFSET ?";
  const identityRows = await db.query<IdentitySummaryRow>(listQuery, [
    limit,
    offset,
  ]);

  const rows = await hydrateIdentitySummaries(db, identityRows);

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

export async function handleSearchIdentities(
  url: URL,
  db: DatabaseAdapter,
): Promise<Response> {
  const rawQuery =
    (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim()
      .toLowerCase();
  const page = Math.max(
    1,
    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  const limit = Math.max(
    1,
    Math.min(
      100,
      parseInt(
        url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE),
        10,
      ) || DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  if (rawQuery.length > LIMITS.searchQuery) {
    return json({
      error: `search query too long (max ${LIMITS.searchQuery} characters)`,
    }, 400);
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

  const like = `%${escapeLikePattern(rawQuery)}%`;

  const baseJoin =
    "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email') AND d.revoked_at IS NULL";
  const matchClause =
    "(LOWER(i.fingerprint) LIKE ? ESCAPE '\\' OR LOWER(d.detail) LIKE ? ESCAPE '\\')";
  const revokedFilter = includeRevoked
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

  const countQuery =
    `SELECT COUNT(DISTINCT i.fingerprint) ${baseJoin} WHERE ${matchClause} ${revokedFilter}`;
  const totalCountRows = await db.query<[number | string | bigint]>(
    countQuery,
    [like, like],
  );
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  const listQuery =
    `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at, CAST(i.revoked_at AS TEXT), i.revocation_certificate ` +
    `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT ? OFFSET ?`;
  const identityRows = await db.query<IdentitySummaryRow>(listQuery, [
    like,
    like,
    limit,
    offset,
  ]);

  const rows = await hydrateIdentitySummaries(db, identityRows);

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
