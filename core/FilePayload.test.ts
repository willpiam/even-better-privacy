import { assertEquals } from "jsr:@std/assert";
import {
  buildEncryptedFilePayload,
  buildEncryptedSignedFilePayload,
} from "./FilePayload.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

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
