const files = [
  "build_desktop_linux.sh",
  "build_desktop_mac.sh",
  "build_desktop_windows.sh",
  "ReadMe.md",
];

const violations: string[] = [];
for (const file of files) {
  const text = await Deno.readTextFile(file);
  if (/\bnpm install\b/.test(text)) violations.push(`${file}: use npm ci`);
  if (/AppImageKit\/releases\/download\/continuous/.test(text)) {
    violations.push(`${file}: appimagetool continuous tag is forbidden`);
  }
}

if (violations.length > 0) {
  console.error("Build script lint failed:");
  for (const violation of violations) console.error(`  ${violation}`);
  Deno.exit(1);
}
