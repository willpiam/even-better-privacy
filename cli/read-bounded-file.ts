/** Reject oversized files before reading, and keep reads bounded if a file grows. */
export async function readBoundedFile(
  path: string,
  limit: number,
): Promise<Uint8Array> {
  const file = await Deno.open(path, { read: true });
  try {
    if ((await file.stat()).size > limit) {
      throw new Error(`File exceeds max supported size (${limit} bytes).`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = new Uint8Array(Math.min(64 * 1024, limit - total + 1));
      const n = await file.read(chunk);
      if (n === null) break;
      total += n;
      if (total > limit) {
        throw new Error(`File exceeds max supported size (${limit} bytes).`);
      }
      chunks.push(chunk.subarray(0, n));
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    file.close();
  }
}
