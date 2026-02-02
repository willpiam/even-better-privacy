import { assert, assertEquals } from "jsr:@std/assert";
import {
	apiUrl,
	buildStateFromExternal,
	canonicalize,
	computeStateHash,
	ensureDir,
	ensureServer,
	getContext,
	listIdentityNames,
	readState,
	stableStringify,
	updateState,
	writeState,
} from "../utils.ts";
import { ExternalIdentity } from "../../core/Identity.ts";

Deno.test({
	name: "state helpers read/write/update round trip",
	permissions: { read: true, write: true },
	fn: async () => {
		const root = await Deno.makeTempDir();
		const dir = `${root}/.ebp`;

		assertEquals(await readState(dir), undefined);

		await writeState(dir, { currentIdentity: "identity-1" });
		assertEquals(await readState(dir), { currentIdentity: "identity-1" });

		const updated = await updateState(dir, { server: "http://example.com" });
		assertEquals(updated, { currentIdentity: "identity-1", server: "http://example.com" });
		assertEquals(await readState(dir), updated);

		await Deno.remove(root, { recursive: true });
	},
});

Deno.test({
	name: "listIdentityNames lists only .identity.json files",
	permissions: { read: true, write: true },
	fn: async () => {
		const root = await Deno.makeTempDir();
		const dir = `${root}/.ebp`;
		await ensureDir(dir);

		await Deno.writeTextFile(`${dir}/alice.identity.json`, "");
		await Deno.writeTextFile(`${dir}/bob.identity.json`, "");
		await Deno.writeTextFile(`${dir}/ignore.txt`, "");

		const names = await listIdentityNames(dir);
		assertEquals(new Set(names), new Set(["alice", "bob"]));

		await Deno.remove(root, { recursive: true });
	},
});

Deno.test({
	name: "getContext builds paths and respects overrides",
	permissions: { read: true, write: true },
	fn: async () => {
		const root = await Deno.makeTempDir();

		const ctxDefault = await getContext(root);
		assertEquals(ctxDefault.identityDir, `${root}/.ebp`);
		assertEquals(ctxDefault.currentIdentity, "identity");
	assertEquals(ctxDefault.identityPath, `${root}/.ebp/identity.identity.json`);

		await writeState(`${root}/.ebp`, { currentIdentity: "saved", server: "http://saved" });
		const ctxOverride = await getContext(root, "override-id", "http://override");
		assertEquals(ctxOverride.currentIdentity, "override-id");
		assertEquals(ctxOverride.server, "http://override");
		assertEquals(ctxOverride.contactsDir, `${root}/.ebp/contacts`);

		await Deno.remove(root, { recursive: true });
	},
});

Deno.test({
	name: "ensureDir is idempotent",
	permissions: { read: true, write: true },
	fn: async () => {
		const root = await Deno.makeTempDir();
		const dir = `${root}/nested/path`;
		await ensureDir(dir);
		await ensureDir(dir);
		const stat = await Deno.stat(dir);
		assert(stat.isDirectory);
		await Deno.remove(root, { recursive: true });
	},
});

Deno.test("canonicalize and stableStringify produce deterministic ordering", () => {
	const a = { b: 2, a: [{ y: 1, x: 2 }] };
	const b = { a: [{ x: 2, y: 1 }], b: 2 };
	assertEquals(canonicalize(a), canonicalize(b));
	assertEquals(stableStringify(a), stableStringify(b));
});

Deno.test("computeStateHash ignores key order", () => {
	const base = {
		fingerprint: "fp",
		signingKeyType: "dilithium",
		encryptionKeyType: "kyber",
		signingKey: "sk",
		encryptionKey: "ek",
		signingKeyDetails: { variant: "v1" },
		encryptionKeyDetails: { variant: "k1" },
		details: {
			email: ["user@example.com", "proof1"] as [string, string],
			name: ["Alice", "proof2"] as [string, string],
		},
	};

	const reordered = {
		...base,
		details: {
			name: ["Alice", "proof2"] as [string, string],
			email: ["user@example.com", "proof1"] as [string, string],
		},
	};

	const h1 = computeStateHash(base);
	const h2 = computeStateHash(reordered);
	assertEquals(h1, h2);
});

Deno.test("buildStateFromExternal maps fields through", () => {
	const ext: ExternalIdentity = {
		fingerprint: "fp",
		signingKeyType: "dilithium",
		encryptionKeyType: "kyber",
		signingKey: "sk",
		encryptionKey: "ek",
		signingKeyDetails: { variant: "v" },
		encryptionKeyDetails: { variant: "k" },
		details: {},
	};
	const details = { email: ["user@example.com", "proof"] as [string, string] };
	const state = buildStateFromExternal(ext, details);
	assertEquals(state, {
		fingerprint: "fp",
		signingKeyType: "dilithium",
		encryptionKeyType: "kyber",
		signingKey: "sk",
		encryptionKey: "ek",
		signingKeyDetails: { variant: "v" },
		encryptionKeyDetails: { variant: "k" },
		details,
	});
});

Deno.test("ensureServer uses override then context and trims slashes", () => {
	const ctx = { identityDir: "", identityPath: "", contactsDir: "", currentIdentity: "", server: "http://base/" };
	const serverFromOverride = ensureServer(ctx, { server: "http://override///" });
	assertEquals(serverFromOverride, "http://override");

	const serverFromCtx = ensureServer(ctx, {});
	assertEquals(serverFromCtx, "http://base");
});

Deno.test("apiUrl joins paths safely", () => {
	assertEquals(apiUrl("http://example.com", "/api"), "http://example.com/api");
	assertEquals(apiUrl("http://example.com/", "api"), "http://example.com/api");
});

