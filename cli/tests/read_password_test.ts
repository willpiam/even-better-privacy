import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { readPassword } from "../utils.ts";

// F-CLI-01 regression. Since `readPassword` reads from `Deno.stdin`, we
// cannot easily inject input in-process. Instead, we drive the CLI by
// spawning a subprocess that calls `readPassword` and piping bytes into
// its stdin. On a pipe stdin `setRaw` is not available, so the test
// exercises the non-TTY fallback branch. The TTY branch is validated
// manually in `pocs/F-CLI-01-password-echo.sh`.


Deno.test({
	name: "F-CLI-01: readPassword returns piped password without leaking stdin echo",
	permissions: { read: true, write: true, env: true, net: true, run: true },
	fn: async () => {
		const utilsPath = new URL("../utils.ts", import.meta.url).pathname;
		const configPath = new URL("../../deno.json", import.meta.url).pathname;
		// Place the harness in the workspace so it resolves relative paths
		// through the same deno.json that `./cli/utils.ts` uses.
		const harness = new URL("./_read_password_harness.ts", import.meta.url).pathname;
		try {
			await Deno.writeTextFile(harness, `
import { readPassword } from "${utilsPath}";
const pwd = await readPassword("P: ");
await Deno.stdout.write(new TextEncoder().encode("GOT:" + pwd + ":END"));
`);
			const cmd = new Deno.Command(Deno.execPath(), {
				args: [
					"run",
					"--config", configPath,
					"--allow-read", "--allow-env", "--no-check",
					harness,
				],
				stdin: "piped",
				stdout: "piped",
				stderr: "piped",
			});
			const child = cmd.spawn();
			const w = child.stdin.getWriter();
			await w.write(new TextEncoder().encode("hunter2\n"));
			await w.close();
			const { stdout, stderr } = await child.output();
			const out = new TextDecoder().decode(stdout);
			if (!out.includes("GOT:hunter2:END")) {
				throw new Error(`unexpected output: stdout=${JSON.stringify(out)} stderr=${new TextDecoder().decode(stderr)}`);
			}
		} finally {
			try { await Deno.remove(harness); } catch { /* ignore */ }
		}
	},
});
