import { KeyedQueue } from "../common/KeyedQueue.ts";
import { parseStrictJson } from "../core/StrictJson.ts";
import { writePrivateFileAtomic } from "./atomic-file.ts";

const updates = new KeyedQueue();

export async function readJsonOptional<T>(path: string): Promise<T | null> {
  try {
    const value = parseStrictJson(await Deno.readTextFile(path));
    if (value === null) throw new Error(`Invalid null JSON store: ${path}`);
    return value as T;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Serialize the complete update across CLI/GUI processes, not just the rename.
 * Never steal a lock: after a crashed writer an operator can remove its .lock
 * directory once they have established the writer is no longer running.
 */
export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = await Deno.realPath(path.slice(0, split));
  const key = `${parent}/${path.slice(split + 1)}`;
  return updates.run(key, async () => {
    const lock = `${key}.lock`;
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        await Deno.mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        if (Date.now() >= deadline) throw new Error(`Store is locked: ${key}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await operation();
    } finally {
      await Deno.remove(lock);
    }
  });
}

export async function updatePrivateJson<T, R>(
  path: string,
  initial: () => T,
  mutate: (value: T) => R | Promise<R>,
): Promise<R> {
  return withFileLock(path, async () => {
    const value = await readJsonOptional<T>(path) ?? initial();
    const result = await mutate(value);
    await writePrivateFileAtomic(path, JSON.stringify(value, null, 2));
    return result;
  });
}
