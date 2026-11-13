import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import {
  HttpError,
  MAX_BODY_SIZE,
  readJson,
  tryServeStatic,
  writeFileExclusive,
} from "../http.ts";

Deno.test({
  name: "static HEAD checks existence without reading file contents",
  permissions: { read: true },
  fn: async () => {
    const readFile = Deno.readFile;
    Deno.readFile = () => {
      throw new Error("HEAD must not read contents");
    };
    try {
      const url = new URL("http://127.0.0.1:8787/index.html");
      const response = await tryServeStatic(
        new Request(url, { method: "HEAD" }),
        url,
      );
      assertEquals(response?.status, 200);
      assertEquals(response?.body, null);
    } finally {
      Deno.readFile = readFile;
    }
  },
});

Deno.test("F-GUI-08: readJson rejects bodies larger than MAX_BODY_SIZE", async () => {
  const body = JSON.stringify({ value: "x".repeat(MAX_BODY_SIZE) });
  await assertRejects(
    () =>
      readJson(
        new Request("http://127.0.0.1:8787/api/v1/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
    HttpError,
    "payload too large",
  );
});

Deno.test({
  name: "F-GUI-02: writeFileExclusive refuses to overwrite existing files",
  permissions: { read: true, write: true },
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "ebp-save-file-test-" });
    try {
      const path = `${dir}/existing.txt`;
      await Deno.writeTextFile(path, "original");
      await assertRejects(
        () => writeFileExclusive(path, new TextEncoder().encode("replacement")),
        HttpError,
        "file already exists",
      );
      assertEquals(await Deno.readTextFile(path), "original");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "F-GUI-11: static file serving rejects encoded traversal",
  permissions: { read: true },
  fn: async () => {
    for (const path of ["/%252e%252e/deno.json"]) {
      const res = await tryServeStatic(
        new Request(`http://127.0.0.1:8787${path}`),
        new URL(`http://127.0.0.1:8787${path}`),
      );
      assertEquals(res?.status, 404);
    }

    const ok = await tryServeStatic(
      new Request("http://127.0.0.1:8787/index.html"),
      new URL("http://127.0.0.1:8787/index.html"),
    );
    assertEquals(ok?.status, 200);
  },
});
