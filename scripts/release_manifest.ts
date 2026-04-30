import { sha256Hex } from "../core/MessageHash.ts";

const paths = Deno.args;
if (paths.length === 0) {
  console.error(
    "usage: deno run --allow-read scripts/release_manifest.ts <artifact>...",
  );
  Deno.exit(2);
}

const lines: string[] = [];
for (const path of paths) {
  const data = await Deno.readFile(path);
  lines.push(`${sha256Hex(data)}  ${path}`);
}
console.log(lines.join("\n"));
