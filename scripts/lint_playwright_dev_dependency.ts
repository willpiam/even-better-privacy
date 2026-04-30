const packagePaths = [
  "package.json",
  "desktop/package.json",
  "mobile/package.json",
];
const forbiddenProdDeps = new Set(["@playwright/test", "playwright"]);
const violations: string[] = [];

for (const path of packagePaths) {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) continue;
    throw e;
  }
  const pkg = JSON.parse(text) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  for (const section of ["dependencies", "optionalDependencies"] as const) {
    for (const dep of Object.keys(pkg[section] ?? {})) {
      if (forbiddenProdDeps.has(dep)) {
        violations.push(`${path}:${section}:${dep}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Playwright must remain in devDependencies only:");
  for (const violation of violations) console.error(`  ${violation}`);
  Deno.exit(1);
}
