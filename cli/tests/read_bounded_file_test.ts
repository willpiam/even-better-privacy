import { assertEquals, assertRejects } from "jsr:@std/assert";
import { readBoundedFile } from "../read-bounded-file.ts";

Deno.test("bounded reads accept empty and exact-limit files and reject oversized files before reading", async () => {
  const dir = await Deno.makeTempDir();
  const open = Deno.open;
  try {
    const path = `${dir}/file`;
    for (const size of [0, 7]) {
      await Deno.writeFile(path, new Uint8Array(size));
      assertEquals((await readBoundedFile(path, 7)).length, size);
    }
    await Deno.writeFile(path, new Uint8Array(8));
    Deno.open = async (...args) => {
      const file = await open(...args);
      return new Proxy(file, {
        get(target, key) {
          if (key === "read") {
            return () => {
              throw new Error("oversized files must not be read");
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    await assertRejects(
      () => readBoundedFile(path, 7),
      Error,
      "max supported size",
    );
  } finally {
    Deno.open = open;
    await Deno.remove(dir, { recursive: true });
  }
});
