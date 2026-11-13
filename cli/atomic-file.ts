/** Replace a private file only after its complete replacement is on disk. */
export async function writePrivateFileAtomic(
  path: string,
  content: string,
): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await Deno.open(temporary, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      const bytes = new TextEncoder().encode(content);
      let offset = 0;
      while (offset < bytes.length) {
        const written = await file.write(bytes.subarray(offset));
        if (written === 0) throw new Error("incomplete identity write");
        offset += written;
      }
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(temporary, path);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}
