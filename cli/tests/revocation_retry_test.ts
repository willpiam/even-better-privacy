import { assertEquals } from "@std/assert";
import { Identity } from "../../core/Identity.ts";
import { writeState } from "../utils.ts";

Deno.test("CLI retries failed detail and identity uploads using the persisted certificates", async () => {
  const home = await Deno.makeTempDir({ prefix: "ebp-cli-revoke-" });
  const password = "Revocation-retry-password1";
  const uploads = new Map<string, string[]>();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (req) => {
      const body = await req.json();
      const attempts = uploads.get(body.type) ?? [];
      attempts.push(body.certificate);
      uploads.set(body.type, attempts);
      return Response.json(
        attempts.length === 1 ? { error: "temporary failure" } : { ok: true },
        { status: attempts.length === 1 ? 503 : 200 },
      );
    },
  );
  try {
    const dir = `${home}/.ebp`;
    await Deno.mkdir(dir);
    const identity = new Identity("dilithium", "kyber");
    identity.attachDetail("name", "Alice");
    await Deno.writeTextFile(
      `${dir}/me.identity.json`,
      identity.toStorageFormat(password),
    );
    await writeState(dir, { currentIdentity: "me" });
    for (const type of ["detail", "identity"]) {
      const action = type === "detail"
        ? ["revoke-detail", "name"]
        : ["revoke", "--force"];
      for (const expectedCode of [1, 0]) {
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-net",
            new URL("../main.ts", import.meta.url).pathname,
            ...action,
            "--home",
            home,
            "--password",
            password,
            "--push",
            "--server",
            `http://127.0.0.1:${server.addr.port}`,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(
          result.code,
          expectedCode,
          new TextDecoder().decode(result.stderr),
        );
      }
      assertEquals(uploads.get(type)?.length, 2);
      assertEquals(uploads.get(type)![0], uploads.get(type)![1]);
    }
    const saved = Identity.fromStorageFormat(
      await Deno.readTextFile(`${dir}/me.identity.json`),
      password,
    );
    assertEquals(saved.revocationNonce, 2);
  } finally {
    await server.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
