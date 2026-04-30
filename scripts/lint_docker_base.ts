const text = await Deno.readTextFile("Dockerfile");
const unpinned = text.split("\n").filter((line) =>
  line.trim().startsWith("FROM ") && !line.includes("@sha256:")
);

if (unpinned.length > 0) {
  console.error("Docker base image must be pinned by sha256 digest:");
  for (const line of unpinned) console.error(`  ${line}`);
  Deno.exit(1);
}
