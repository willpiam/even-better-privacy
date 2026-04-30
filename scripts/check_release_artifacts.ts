const forbidden = [
  /(^|\/)test_identities(\/|$)/,
  /(^|\/)ebp\.sqlite$/,
  /\.sqlite$/,
];

const roots = Deno.args.length > 0 ? Deno.args : [
  "dist",
  "desktop/src-tauri/target/release/bundle",
];

const matches: string[] = [];

async function scan(path: string): Promise<void> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    throw e;
  }
  if (stat.isFile) {
    const normalized = path.replace(/\\/g, "/");
    if (forbidden.some((pattern) => pattern.test(normalized))) {
      matches.push(path);
    }
    return;
  }
  if (!stat.isDirectory) return;
  for await (const entry of Deno.readDir(path)) {
    await scan(`${path}/${entry.name}`);
  }
}

for (const root of roots) await scan(root);

if (matches.length > 0) {
  console.error("Release artifacts contain forbidden fixture/database files:");
  for (const match of matches) console.error(`  ${match}`);
  Deno.exit(1);
}
