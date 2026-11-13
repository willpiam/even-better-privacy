import { assertEquals, assertRejects } from "jsr:@std/assert";
import { writePrivateFileAtomic } from "../atomic-file.ts";

Deno.test("atomic private-file replacement preserves the original on partial write failure", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/me.identity.json`;
  const open = Deno.open;
  try {
    await Deno.writeTextFile(path, "original identity");
    Deno.open = async (...args: Parameters<typeof Deno.open>) => {
      const file = await open(...args);
      if (String(args[0]).startsWith(`${path}.`)) {
        return {
          write: async (bytes: Uint8Array) => {
            await file.write(bytes.subarray(0, 3));
            throw new Error("simulated disk full");
          },
          sync: () => file.sync(),
          close: () => file.close(),
        } as unknown as Deno.FsFile;
      }
      return file;
    };
    await assertRejects(
      () => writePrivateFileAtomic(path, "replacement"),
      Error,
      "simulated disk full",
    );
    assertEquals(await Deno.readTextFile(path), "original identity");
    assertEquals(Array.from(Deno.readDirSync(dir), (entry) => entry.name), [
      "me.identity.json",
    ]);
    Deno.open = open;
    await writePrivateFileAtomic(path, "complete replacement");
    assertEquals(await Deno.readTextFile(path), "complete replacement");
    if (Deno.build.os !== "windows") {
      assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
    }
  } finally {
    Deno.open = open;
    await Deno.remove(dir, { recursive: true });
  }
});
