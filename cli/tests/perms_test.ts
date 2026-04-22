import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { Identity } from "../../core/Identity.ts";
import {
	ensurePrivateDir,
	fixLegacyPerms,
	saveIdentity,
	writeState,
} from "../utils.ts";

// F-STORAGE-01/04 regression tests. These only check Unix file modes; they
// are skipped on Windows where Deno's `mode` option is a no-op.

const isUnix = Deno.build.os !== "windows";

async function statMode(path: string): Promise<number> {
	const s = await Deno.stat(path);
	// Deno returns mode as a number; mask for perms.
	return (s.mode ?? 0) & 0o777;
}

Deno.test({
	name: "F-STORAGE-04: ensurePrivateDir creates dir at mode 0700",
	ignore: !isUnix,
	permissions: { read: true, write: true, env: true },
	fn: async () => {
		const tmp = await Deno.makeTempDir({ prefix: "ebp-perms-" });
		try {
			const dir = `${tmp}/.ebp`;
			await ensurePrivateDir(dir);
			assertEquals(await statMode(dir), 0o700);
		} finally {
			await Deno.remove(tmp, { recursive: true });
		}
	},
});

Deno.test({
	name: "F-STORAGE-01: saveIdentity writes identity file at mode 0600",
	ignore: !isUnix,
	permissions: { read: true, write: true, env: true },
	fn: async () => {
		const tmp = await Deno.makeTempDir({ prefix: "ebp-perms-" });
		try {
			const identityDir = `${tmp}/.ebp`;
			const ctx = {
				identityDir,
				identityPath: `${identityDir}/identity.identity.json`,
				contactsDir: `${identityDir}/contacts`,
				currentIdentity: "identity",
			};
			const identity = new Identity("dilithium", "kyber");
			await saveIdentity(ctx, "password12345", identity);
			assertEquals(await statMode(ctx.identityPath), 0o600);
			assertEquals(await statMode(identityDir), 0o700);
		} finally {
			await Deno.remove(tmp, { recursive: true });
		}
	},
});

Deno.test({
	name: "F-STORAGE-01: writeState writes state.json at mode 0600",
	ignore: !isUnix,
	permissions: { read: true, write: true, env: true },
	fn: async () => {
		const tmp = await Deno.makeTempDir({ prefix: "ebp-perms-" });
		try {
			const dir = `${tmp}/.ebp`;
			await writeState(dir, { currentIdentity: "identity" });
			assertEquals(await statMode(`${dir}/state.json`), 0o600);
			assertEquals(await statMode(dir), 0o700);
		} finally {
			await Deno.remove(tmp, { recursive: true });
		}
	},
});

Deno.test({
	name: "F-STORAGE-01/04: fixLegacyPerms tightens loose pre-existing files",
	ignore: !isUnix,
	permissions: { read: true, write: true, env: true },
	fn: async () => {
		const tmp = await Deno.makeTempDir({ prefix: "ebp-perms-" });
		try {
			const dir = `${tmp}/.ebp`;
			await Deno.mkdir(dir, { recursive: true, mode: 0o775 });
			await Deno.writeTextFile(`${dir}/x.identity.json`, "dummy", { mode: 0o664 });
			const subdir = `${dir}/contacts`;
			await Deno.mkdir(subdir, { mode: 0o775 });
			await Deno.writeTextFile(`${subdir}/a.json`, "dummy", { mode: 0o664 });

			await fixLegacyPerms(dir);

			assertEquals(await statMode(dir), 0o700);
			assertEquals(await statMode(`${dir}/x.identity.json`), 0o600);
			assertEquals(await statMode(subdir), 0o700);
			assertEquals(await statMode(`${subdir}/a.json`), 0o600);
		} finally {
			await Deno.remove(tmp, { recursive: true });
		}
	},
});
