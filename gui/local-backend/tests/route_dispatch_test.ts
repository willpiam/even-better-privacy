import { assertEquals } from "@std/assert";
import { Identity } from "../../../core/Identity.ts";
import { sha256Hex } from "../../../core/MessageHash.ts";
import { writeState } from "../../../cli/utils.ts";
import { handleRequest } from "../routes.ts";
import { getCsrfToken, initSecurity } from "../security.ts";
import { lockAll } from "../unlock-session.ts";

Deno.test("domain dispatcher preserves the identity, contact, messaging, file, and revocation flow", async () => {
  const home = await Deno.makeTempDir({ prefix: "ebp-route-domains-" });
  const password = "Route-Regression-Password-7";
  try {
    await initSecurity({ home, persist: false });
    const identity = new Identity("dilithium", "kyber");
    await Deno.mkdir(`${home}/.ebp`, { recursive: true });
    await writeState(`${home}/.ebp`, { currentIdentity: "me" });
    await Deno.writeTextFile(
      `${home}/.ebp/me.identity.json`,
      identity.toStorageFormat(password),
    );
    const query = `?home=${encodeURIComponent(home)}`;
    const call = async (
      method: string,
      path: string,
      body?: Record<string, unknown>,
    ) => {
      const res = await handleRequest(
        new Request(`http://127.0.0.1:8787${path}`, {
          method,
          headers: {
            host: "127.0.0.1:8787",
            "x-ebp-csrf": getCsrfToken(),
            "content-type": "application/json",
          },
          body: body
            ? JSON.stringify({ home, identity: "me", ...body })
            : undefined,
        }),
      );
      const data = await res.json();
      assertEquals(res.status, 200, JSON.stringify(data));
      return data;
    };
    assertEquals((await call("GET", "/api/v1/health")).ok, true);
    await call("GET", "/api/v1/context" + query);
    await call("POST", "/api/v1/identity/unlock", { password });
    await call("POST", "/api/v1/contacts/import", {
      name: "self",
      contact: identity.summary,
    });
    assertEquals(
      (await call("GET", "/api/v1/contacts" + query)).contacts.length,
      1,
    );
    const message = "Domain routing round trip";
    const signed = await call("POST", "/api/v1/sign", {
      message,
      signConfirmation: {
        approved: true,
        approvedAt: Date.now(),
        messageHash: sha256Hex(message),
      },
    });
    assertEquals(
      (await call("POST", "/api/v1/verify", {
        payload: signed,
        sender: "self",
      })).verified,
      true,
    );
    const encrypted = await call("POST", "/api/v1/encrypt", {
      message,
      recipient: "self",
      sign: true,
    });
    const decrypted = await call("POST", "/api/v1/decrypt", {
      payload: encrypted,
      sender: "self",
    });
    assertEquals(decrypted.message, message);
    assertEquals(decrypted.verified, true);
    const fileDataBase64 = btoa("file contents");
    const file = await call("POST", "/api/v1/encrypt-file", {
      recipient: "self",
      sign: true,
      fileName: "sample.txt",
      mimeType: "text/plain",
      fileDataBase64,
    });
    const restored = await call("POST", "/api/v1/decrypt-file", {
      payload: file,
      sender: "self",
    });
    assertEquals(restored.fileDataBase64, fileDataBase64);
    assertEquals(restored.verified, true);
    await call("GET", "/api/v1/hierarchy/list" + query);
    await call("GET", "/api/v1/mail/accounts" + query);
    await call("GET", "/api/v1/server" + query);
    await call("POST", "/api/v1/detail", { path: "name", detail: "Alice" });
    await call("POST", "/api/v1/revoke/detail", { path: "name" });
    await call("POST", "/api/v1/revoke/identity", {});
    assertEquals(
      (await call("GET", "/api/v1/identity/public" + query)).revoked,
      true,
    );
  } finally {
    lockAll();
    await Deno.remove(home, { recursive: true });
  }
});
