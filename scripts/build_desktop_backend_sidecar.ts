const targetByHost: Record<string, string> = {
  "linux:x86_64": "x86_64-unknown-linux-gnu",
  "linux:aarch64": "aarch64-unknown-linux-gnu",
  "darwin:x86_64": "x86_64-apple-darwin",
  "darwin:aarch64": "aarch64-apple-darwin",
  "windows:x86_64": "x86_64-pc-windows-msvc",
};

const hostKey = `${Deno.build.os}:${Deno.build.arch}`;
const target = Deno.env.get("EBP_DENO_TARGET") ?? targetByHost[hostKey];

if (!target) {
  console.error(`ERROR: Unsupported host for desktop sidecar build: ${hostKey}`);
  console.error("Set EBP_DENO_TARGET to a valid Deno compile target if needed.");
  Deno.exit(1);
}

const sidecarBase = "./desktop/src-tauri/bin/ebp-gui-backend";
const sidecarTargeted = `${sidecarBase}-${target}`;

console.log(`Compiling desktop sidecar for target: ${target}`);

const compile = new Deno.Command("deno", {
  args: [
    "compile",
    "--target",
    target,
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-net",
    "--include",
    "./gui/index.html",
    "--include",
    "./gui/app.js",
    "--output",
    sidecarTargeted,
    "./gui/local-backend/main.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});

const compileResult = await compile.output();
if (!compileResult.success) {
  Deno.exit(compileResult.code);
}

await Deno.copyFile(sidecarTargeted, sidecarBase);

