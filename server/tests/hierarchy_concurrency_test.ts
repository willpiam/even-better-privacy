import { assertEquals, assertRejects } from "jsr:@std/assert";
import { Identity } from "../../core/Identity.ts";
import {
  createHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  type SignedHierarchyCertificate,
} from "../../core/HierarchyCertificate.ts";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { insertIdentity } from "../db/index.ts";
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
