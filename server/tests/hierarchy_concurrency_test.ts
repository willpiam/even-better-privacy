import { assertEquals, assertRejects } from "@std/assert";
import { Identity } from "../../core/Identity.ts";
import {
  createHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  type SignedHierarchyCertificate,
} from "../../core/HierarchyCertificate.ts";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { insertIdentity } from "../db/index.ts";
import type { DatabaseAdapter, DatabaseQueryParams } from "../db/adapter.ts";
import {
  getHierarchyForIdentity,
  listHierarchyCertificates,
  verifyAndInsertHierarchyCertificate,
} from "../hierarchy.ts";
import { buildHierarchyTreeFromCertificates as mobileTree } from "../../mobile/src/services/hierarchyTree.ts";
import { buildHierarchyTreeFromCertificates as desktopTree } from "../../gui/local-backend/hierarchy-local.ts";

function certificate(
  master: Identity,
  child: Identity,
): SignedHierarchyCertificate {
  const cert = createHierarchyCertificate(
    master.toFingerprint(),
    child.toFingerprint(),
  );
  const payload = getHierarchySignaturePayload(cert);
  cert.masterSignature = master.signMessage(payload, undefined, "hierarchy");
  cert.childSignature = child.signMessage(payload, undefined, "hierarchy");
  return cert as SignedHierarchyCertificate;
}

Deno.test("concurrent graph writes cannot commit a cycle and failed transactions roll back", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  try {
    const a = new Identity("dilithium", "kyber");
    const b = new Identity("dilithium", "kyber");
    for (const identity of [a, b]) {
      await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
    }
    const ab = certificate(a, b), ba = certificate(b, a);
    const results = await Promise.all(
      [ab, ba].map((cert) =>
        verifyAndInsertHierarchyCertificate(
          db,
          encodeHierarchyCertificate(cert),
        )
      ),
    );
    assertEquals(results.filter((result) => result.ok).length, 1);
    assertEquals((await listHierarchyCertificates(db)).length, 1);
    await getHierarchyForIdentity(db, a.toFingerprint());
    await assertRejects(
      () =>
        db.writeTransaction(async (tx) => {
          await tx.execute("DELETE FROM hierarchy_certificates");
          throw new Error("abort");
        }),
      Error,
      "abort",
    );
    assertEquals((await listHierarchyCertificates(db)).length, 1);
    for (const tree of [mobileTree, desktopTree]) {
      assertEquals(tree(a.toFingerprint(), [ab]).descendants.length, 1);
      let failed = false;
      try {
        tree(a.toFingerprint(), [ab, ba]);
      } catch {
        failed = true;
      }
      assertEquals(failed, true);
    }
    // Simulate corrupt stored data: traversal must reject, never spin forever.
    await db.execute("DELETE FROM hierarchy_certificates");
    for (const cert of [ab, ba]) {
      await db.query(
        "INSERT INTO hierarchy_certificates (master_fingerprint,child_fingerprint,timestamp,expiry,context,certificate,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          cert.masterFingerprint,
          cert.childFingerprint,
          cert.timestamp,
          0,
          "",
          encodeHierarchyCertificate(cert),
          Date.now(),
        ],
      );
    }
    await assertRejects(
      () => getHierarchyForIdentity(db, a.toFingerprint()),
      Error,
      "cycle",
    );
  } finally {
    await db.close();
  }
});

Deno.test("hierarchy reads materialize only the focused family", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  try {
    const identity = new Identity("dilithium", "kyber");
    for (
      const fingerprint of [
        "root",
        "child",
        "grandchild",
        ...Array.from({ length: 30 }, (_, i) => `other-${i}`),
      ]
    ) {
      await insertIdentity(db, {
        ...identity.summary,
        fingerprint,
        createdAt: 0,
      });
    }
    for (
      const [master, child] of [
        ["root", "child"],
        ["child", "grandchild"],
        ...Array.from(
          { length: 29 },
          (_, i) => [`other-${i}`, `other-${i + 1}`],
        ),
      ]
    ) {
      await db.query(
        "INSERT INTO hierarchy_certificates (master_fingerprint, child_fingerprint, timestamp, expiry, context, certificate, created_at) VALUES (?, ?, 0, 0, '', 'certificate', 0)",
        [master, child],
      );
    }
    let materialized = 0;
    const instrumented: DatabaseAdapter = {
      execute: db.execute.bind(db),
      close: db.close.bind(db),
      writeTransaction: db.writeTransaction.bind(db),
      query: async <T extends unknown[]>(
        sql: string,
        params?: DatabaseQueryParams,
      ) => {
        const rows = await db.query<T>(sql, params);
        materialized += rows.length;
        return rows;
      },
    };
    const family = await getHierarchyForIdentity(instrumented, "child");
    assertEquals(family.root, "root");
    assertEquals(family.descendants, ["child", "grandchild"]);
    assertEquals(materialized, 2);
  } finally {
    await db.close();
  }
});

Deno.test("hierarchy database failures preserve the original cause and roll back", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  try {
    const master = new Identity("dilithium", "kyber"),
      child = new Identity("dilithium", "kyber");
    for (const identity of [master, child]) {
      await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
    }
    const cause = Object.assign(new Error("storage unavailable"), {
      code: "08006",
    });
    const failing: DatabaseAdapter = {
      execute: db.execute.bind(db),
      query: db.query.bind(db),
      close: db.close.bind(db),
      writeTransaction: (operation) =>
        db.writeTransaction((tx) =>
          operation({
        execute: tx.execute.bind(tx),
        close: tx.close.bind(tx),
        writeTransaction: tx.writeTransaction.bind(tx),
            query: <T extends unknown[]>(
              sql: string,
              params?: DatabaseQueryParams,
            ): Promise<T[]> => {
              if (sql.includes("INSERT INTO hierarchy_certificates")) {
                throw cause;
              }
              return tx.query<T>(sql, params);
            },
          })
        ),
    };
    const error = await assertRejects(
      () =>
        verifyAndInsertHierarchyCertificate(
          failing,
          encodeHierarchyCertificate(certificate(master, child)),
        ),
      Error,
      "Failed to insert hierarchy certificate",
    );
    assertEquals(error.cause, cause);
    assertEquals((await listHierarchyCertificates(db)).length, 0);
  } finally {
    await db.close();
  }
});
