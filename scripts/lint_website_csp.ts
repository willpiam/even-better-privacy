const websiteDir = new URL("../website/", import.meta.url);

const requiredDirectives = [
  "default-src 'none'",
  "style-src 'self'",
  "base-uri 'none'",
];

let failed = false;

for await (const entry of Deno.readDir(websiteDir)) {
  if (!entry.isFile || !entry.name.endsWith(".html")) continue;
  const path = new URL(entry.name, websiteDir);
  const html = await Deno.readTextFile(path);
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/i,
  );
  if (!match) {
    console.error(`${entry.name}: missing Content-Security-Policy meta tag`);
    failed = true;
    continue;
  }
  for (const directive of requiredDirectives) {
    if (!match[1].includes(directive)) {
      console.error(`${entry.name}: CSP missing directive ${directive}`);
      failed = true;
    }
  }
}

const headersPath = new URL("_headers", websiteDir);
try {
  const headers = await Deno.readTextFile(headersPath);
  if (!headers.includes("Content-Security-Policy: default-src 'none'")) {
    console.error("_headers: missing static-host Content-Security-Policy");
    failed = true;
  }
} catch {
  console.error("_headers: missing static-host security headers");
  failed = true;
}

if (failed) Deno.exit(1);
