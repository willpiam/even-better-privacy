import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  buildEncryptedFilePayload,
  buildEncryptedSignedFilePayload,
  createFileCleartextEnvelope,
  parseFileCleartextEnvelope,
} from "./FilePayload.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

Deno.test("empty files round-trip without accepting mismatched declared sizes", () => {
  const envelope = createFileCleartextEnvelope(new Uint8Array(0), "empty.txt");
  const result = parseFileCleartextEnvelope(JSON.stringify(envelope));
  assertEquals(result.fileName, "empty.txt");
  assertEquals(result.fileSize, 0);
  assertEquals(result.fileBytes, new Uint8Array(0));
  assertThrows(
    () =>
      parseFileCleartextEnvelope(JSON.stringify({ ...envelope, fileSize: 1 })),
    Error,
    "size mismatch",
  );
});

Deno.test("FilePayload builders include version fields", () => {
  const encrypted = buildEncryptedFilePayload({
    recipientFingerprint: "ebpdk1recipient",
    fileName: "doc.pdf",
    mimeType: "application/pdf",
    fileSize: 42,
    ciphertext: "deadbeef",
  });
  assertEquals(encrypted.type, "ebp-encrypted-file");
  assertEquals(encrypted.version, FILE_FORMAT_VERSIONS.encryptedFile);

  const signed = buildEncryptedSignedFilePayload({
    recipientFingerprint: "ebpdk1recipient",
    senderFingerprint: "ebpdk1sender",
    fileName: "doc.pdf",
    mimeType: "application/pdf",
    fileSize: 42,
    ciphertext: "deadbeef",
  });
  assertEquals(signed.type, "ebp-encrypted-signed-file");
  assertEquals(signed.version, FILE_FORMAT_VERSIONS.encryptedSignedFile);
});
