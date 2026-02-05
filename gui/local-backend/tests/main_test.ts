import { assertEquals, assert, assertExists, assertStringIncludes } from "jsr:@std/assert@^1.0.6";
import { Identity, ExternalIdentity } from "../../../core/Identity.ts";
import { ensureDir, writeState } from "../../../cli/utils.ts";
import { PROTOCOL_VERSION } from "../../../core/version.ts";

// We import the handler dynamically to avoid starting the server
// Instead, we'll test the request handling logic directly

const STATUS = {
	OK: 200,
	Created: 201,
	BadRequest: 400,
	Unauthorized: 401,
	NotFound: 404,
	Conflict: 409,
} as const;

// Helper to make a fetch-like request to the handler
type RequestInit = {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
};

async function makeRequest(
	handler: (req: Request) => Promise<Response>,
	path: string,
	init?: RequestInit
): Promise<{ status: number; body: unknown }> {
	const url = `http://localhost${path}`;
	const req = new Request(url, {
		method: init?.method ?? "GET",
		headers: init?.headers ?? {},
		body: init?.body,
	});
	const res = await handler(req);
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	return { status: res.status, body };
}

function jsonPost(data: unknown): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(data),
	};
}

// Create isolated temp environment for tests
async function withTestEnv(fn: (home: string, handler: (req: Request) => Promise<Response>) => Promise<void>) {
	const home = await Deno.makeTempDir({ prefix: "ebp-test-" });
	const ebpDir = `${home}/.ebp`;
	const contactsDir = `${ebpDir}/contacts`;
	await ensureDir(ebpDir);
	await ensureDir(contactsDir);

	// Dynamically import the module to get the handler
	// We use a workaround: create a minimal handler that processes requests
	const { handleRequestForTest } = await import("./test_handler.ts");
	
	try {
		await fn(home, handleRequestForTest);
	} finally {
		await Deno.remove(home, { recursive: true });
	}
}

// Helper to create a test identity file
async function createTestIdentity(home: string, name: string, password: string): Promise<Identity> {
	const identity = new Identity("dilithium", "kyber");
	const ebpDir = `${home}/.ebp`;
	await ensureDir(ebpDir);
	const storageData = await identity.toStorageFormat(password);
	await Deno.writeTextFile(`${ebpDir}/${name}.identity.json`, storageData);
	return identity;
}

// Helper to create a test contact file
async function createTestContact(home: string, name: string, contact: ExternalIdentity): Promise<void> {
	const contactsDir = `${home}/.ebp/contacts`;
	await ensureDir(contactsDir);
	await Deno.writeTextFile(`${contactsDir}/${name}.json`, JSON.stringify(contact, null, 2));
}

// =============================================================================
// Tests
// =============================================================================

Deno.test({
	name: "GET /api/v1/health returns ok and protocol version",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(handler, "/api/v1/health");
			assertEquals(status, STATUS.OK);
			assertEquals((body as Record<string, unknown>).ok, true);
			assertEquals((body as Record<string, unknown>).protocolVersion, PROTOCOL_VERSION);
		});
	},
});

Deno.test({
	name: "GET /api/v1/context returns context with protocol version",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(handler, `/api/v1/context?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			const b = body as Record<string, unknown>;
			assertStringIncludes(b.identityDir as string, ".ebp");
			assertEquals(b.currentIdentity, "identity");
			assertEquals(b.protocolVersion, PROTOCOL_VERSION);
		});
	},
});

Deno.test({
	name: "GET /api/v1/identities lists identities",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create two test identities
			await createTestIdentity(home, "alice", "password123");
			await createTestIdentity(home, "bob", "password456");
			await writeState(`${home}/.ebp`, { currentIdentity: "alice" });

			const { status, body } = await makeRequest(handler, `/api/v1/identities?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			const b = body as { identities: Array<{ name: string; fingerprint: string | null }>; currentIdentity: string };
			assertEquals(b.identities.length, 2);
			const names = b.identities.map(i => i.name).sort();
			assertEquals(names, ["alice", "bob"]);
			assertEquals(b.currentIdentity, "alice");
		});
	},
});

Deno.test({
	name: "GET /api/v1/identity/public returns public data for new format identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(handler, `/api/v1/identity/public?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			const b = body as Record<string, unknown>;
			assertEquals(b.available, true);
			assertEquals(b.fingerprint, identity.toFingerprint());
			assertEquals(b.signingKeyType, "dilithium");
			assertEquals(b.encryptionKeyType, "kyber");
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/generate creates new identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/generate",
				jsonPost({
					name: "newident",
					password: "securepassword123",
					signingType: "dilithium",
					encryptionType: "kyber",
					home,
				})
			);
			assertEquals(status, STATUS.Created);
			const b = body as { ok: boolean; identity: { name: string; fingerprint: string } };
			assertEquals(b.ok, true);
			assertEquals(b.identity.name, "newident");
			assertExists(b.identity.fingerprint);

			// Verify file was created
			const stat = await Deno.stat(`${home}/.ebp/newident.identity.json`);
			assert(stat.isFile);
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/generate rejects short password",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/generate",
				jsonPost({
					name: "badpass",
					password: "short",
					home,
				})
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "password");
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/generate rejects duplicate without force",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "existing", "password123");

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/generate",
				jsonPost({
					name: "existing",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.Conflict);
			assertStringIncludes((body as { error: string }).error, "already exists");
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/use switches current identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "alice", "password123");
			await createTestIdentity(home, "bob", "password456");
			await writeState(`${home}/.ebp`, { currentIdentity: "alice" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/use",
				jsonPost({ name: "bob", home })
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { ok: boolean; currentIdentity: string }).currentIdentity, "bob");
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/use rejects nonexistent identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/use",
				jsonPost({ name: "nonexistent", home })
			);
			assertEquals(status, STATUS.NotFound);
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/info returns identity info with correct password",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/info",
				jsonPost({ password: "password123", home })
			);
			assertEquals(status, STATUS.OK);
			const b = body as { fingerprint: string };
			assertEquals(b.fingerprint, identity.toFingerprint());
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/info rejects wrong password",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/info",
				jsonPost({ password: "wrongpassword", home })
			);
			assertEquals(status, STATUS.Unauthorized);
			assertStringIncludes((body as { error: string }).error, "decrypt");
		});
	},
});

Deno.test({
	name: "POST /api/v1/identity/export-public returns public summary",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/identity/export-public",
				jsonPost({ password: "password123", home })
			);
			assertEquals(status, STATUS.OK);
			const b = body as ExternalIdentity;
			assertEquals(b.fingerprint, identity.toFingerprint());
			assertExists(b.signingKey);
			assertExists(b.encryptionKey);
		});
	},
});

Deno.test({
	name: "GET /api/v1/contacts lists contacts",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create an identity first (to have a contacts dir)
			const identity = await createTestIdentity(home, "test", "password123");

			// Create a contact
			const contact: ExternalIdentity = {
				fingerprint: "abc123",
				signingKeyType: "dilithium",
				encryptionKeyType: "kyber",
				signingKey: "pk-sign",
				encryptionKey: "pk-enc",
				details: {},
				signingKeyDetails: undefined,
				encryptionKeyDetails: undefined,
			};
			await createTestContact(home, "friend", contact);

			const { status, body } = await makeRequest(handler, `/api/v1/contacts?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			const b = body as { contacts: Array<{ name: string; fingerprint: string }> };
			assertEquals(b.contacts.length, 1);
			assertEquals(b.contacts[0].name, "friend");
			assertEquals(b.contacts[0].fingerprint, "abc123");
		});
	},
});

Deno.test({
	name: "POST /api/v1/contacts/import imports a contact",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const contact: ExternalIdentity = {
				fingerprint: "newcontact123456",
				signingKeyType: "dilithium",
				encryptionKeyType: "kyber",
				signingKey: "pk-sign",
				encryptionKey: "pk-enc",
				details: {},
				signingKeyDetails: undefined,
				encryptionKeyDetails: undefined,
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/contacts/import",
				jsonPost({ contact, name: "newbuddy", home })
			);
			assertEquals(status, STATUS.OK);
			const b = body as { ok: boolean; name: string; fingerprint: string };
			assertEquals(b.ok, true);
			assertEquals(b.name, "newbuddy");
			assertEquals(b.fingerprint, "newcontact123456");

			// Verify file was created
			const stat = await Deno.stat(`${home}/.ebp/contacts/newbuddy.json`);
			assert(stat.isFile);
		});
	},
});

Deno.test({
	name: "POST /api/v1/contacts/import rejects invalid contact",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/contacts/import",
				jsonPost({ contact: { fingerprint: "abc" }, home }) // missing signingKey, encryptionKey
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "missing");
		});
	},
});

Deno.test({
	name: "POST /api/v1/sign creates signed message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/sign",
				jsonPost({
					message: "Hello, World!",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { type: string; fingerprint: string; message: string; signature: string };
			assertEquals(b.type, "ebp-signed-message");
			assertEquals(b.message, "Hello, World!");
			assertEquals(b.fingerprint, identity.toFingerprint());
			assertExists(b.signature);
		});
	},
});

Deno.test({
	name: "POST /api/v1/sign with detached creates detached signature",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/sign",
				jsonPost({
					message: "Hello, World!",
					password: "password123",
					detached: true,
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { type: string; signature: string };
			assertEquals(b.type, "ebp-signature");
			assertExists(b.signature);
			// detached should not include the message
			assertEquals((b as Record<string, unknown>).message, undefined);
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify verifies valid signature",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			// Create a contact for verification (self)
			const selfContact: ExternalIdentity = identity.summary;
			await createTestContact(home, "self", selfContact);

			// Sign a message
			const signRes = await makeRequest(
				handler,
				"/api/v1/sign",
				jsonPost({
					message: "Hello, World!",
					password: "password123",
					home,
				})
			);
			const signedMessage = signRes.body;

			// Verify the signature
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload: signedMessage,
					sender: "self",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { verified: boolean }).verified, true);
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify accepts detached signature with public identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const message = "Detached verification check";
			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: identity.toFingerprint(),
				signature: identity.signMessage(message),
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					message,
					publicIdentity: identity.summary,
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { verified: boolean }).verified, true);
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify rejects detached signature without message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: identity.toFingerprint(),
				signature: identity.signMessage("message"),
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					publicIdentity: identity.summary,
					home,
				})
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "message is required");
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify rejects public identity missing signing key",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const message = "Detached verification check";
			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: identity.toFingerprint(),
				signature: identity.signMessage(message),
			};

			const publicIdentity = { ...identity.summary, signingKey: "" };
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					message,
					publicIdentity,
					home,
				})
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "signing key");
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify rejects public identity with invalid signing key type",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const message = "Detached verification check";
			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: identity.toFingerprint(),
				signature: identity.signMessage(message),
			};

			const publicIdentity = { ...identity.summary, signingKeyType: "rsa" };
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					message,
					publicIdentity,
					home,
				})
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "signing key type");
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify returns false for detached signature with wrong message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: identity.toFingerprint(),
				signature: identity.signMessage("correct message"),
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					message: "wrong message",
					publicIdentity: identity.summary,
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { verified: boolean }).verified, false);
		});
	},
});

Deno.test({
	name: "POST /api/v1/verify returns false for detached signature with mismatched keys",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const signer = await createTestIdentity(home, "signer", "password123");
			const other = await createTestIdentity(home, "other", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "signer" });

			const message = "Detached verification check";
			const payload = {
				type: "ebp-signature",
				version: 1,
				fingerprint: signer.toFingerprint(),
				signature: signer.signMessage(message),
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/verify",
				jsonPost({
					payload,
					message,
					publicIdentity: other.summary,
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { verified: boolean }).verified, false);
		});
	},
});

Deno.test({
	name: "POST /api/v1/encrypt creates encrypted message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create sender identity
			await createTestIdentity(home, "sender", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "sender" });

			// Create recipient identity and add as contact
			const recipient = new Identity("dilithium", "kyber");
			await createTestContact(home, "recipient", recipient.summary);

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/encrypt",
				jsonPost({
					message: "Secret message",
					recipient: "recipient",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { type: string; ciphertext: string };
			assertEquals(b.type, "ebp-encrypted-message");
			assertExists(b.ciphertext);
		});
	},
});

Deno.test({
	name: "POST /api/v1/encrypt with sign creates signed encrypted message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const sender = await createTestIdentity(home, "sender", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "sender" });

			const recipient = new Identity("dilithium", "kyber");
			await createTestContact(home, "recipient", recipient.summary);

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/encrypt",
				jsonPost({
					message: "Secret signed message",
					recipient: "recipient",
					sign: true,
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { type: string; senderFingerprint: string; ciphertext: string };
			assertEquals(b.type, "ebp-encrypted-signed-message");
			assertEquals(b.senderFingerprint, sender.toFingerprint());
			assertExists(b.ciphertext);
		});
	},
});

Deno.test({
	name: "POST /api/v1/decrypt decrypts unsigned message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create recipient identity
			const recipient = await createTestIdentity(home, "recipient", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "recipient" });

			// Encrypt directly (not via API) for the recipient
			const plaintext = "Hello, recipient!";
			const ciphertext = Identity.EncryptFor(recipient.summary, plaintext);

			const payload = {
				type: "ebp-encrypted-message",
				recipientFingerprint: recipient.toFingerprint(),
				ciphertext,
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/decrypt",
				jsonPost({
					payload,
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { message: string; verified: null; verifyStatus: string };
			assertEquals(b.message, plaintext);
			assertEquals(b.verified, null);
			assertEquals(b.verifyStatus, "unsigned");
		});
	},
});

Deno.test({
	name: "POST /api/v1/decrypt decrypts and verifies signed message",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create sender and recipient identities
			const sender = new Identity("dilithium", "kyber");
			const recipient = await createTestIdentity(home, "recipient", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "recipient" });

			// Add sender as contact
			await createTestContact(home, "sender", sender.summary);

			// Sender encrypts and signs
			const plaintext = "Hello, recipient!";
			const ciphertext = sender.signAndEncryptFor(plaintext, recipient.summary);

			const payload = {
				type: "ebp-encrypted-signed-message",
				senderFingerprint: sender.toFingerprint(),
				recipientFingerprint: recipient.toFingerprint(),
				ciphertext,
			};

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/decrypt",
				jsonPost({
					payload,
					sender: "sender",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { message: string; verified: boolean; verifyStatus: string };
			assertEquals(b.message, plaintext);
			assertEquals(b.verified, true);
			assertEquals(b.verifyStatus, "valid");
		});
	},
});

Deno.test({
	name: "GET /api/v1/server returns configured server",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await writeState(`${home}/.ebp`, { currentIdentity: "identity", server: "http://example.com" });

			const { status, body } = await makeRequest(handler, `/api/v1/server?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { server: string }).server, "http://example.com");
		});
	},
});

Deno.test({
	name: "POST /api/v1/server sets server URL",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/server",
				jsonPost({ url: "http://new-server.com", home })
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { ok: boolean; server: string }).server, "http://new-server.com");
		});
	},
});

Deno.test({
	name: "POST /api/v1/server with clear removes server URL",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await writeState(`${home}/.ebp`, { currentIdentity: "identity", server: "http://old-server.com" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/server",
				jsonPost({ clear: true, home })
			);
			assertEquals(status, STATUS.OK);
			assertEquals((body as { ok: boolean; server: string | null }).server, null);
		});
	},
});

Deno.test({
	name: "POST /api/v1/detail attaches detail to identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/detail",
				jsonPost({
					path: "profile/name",
					detail: "Alice",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { ok: boolean; path: string; detail: string };
			assertEquals(b.ok, true);
			assertEquals(b.path, "profile/name");
			assertEquals(b.detail, "Alice");
		});
	},
});

Deno.test({
	name: "OPTIONS requests return CORS headers",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (_home, handler) => {
			const req = new Request("http://localhost/api/v1/health", { method: "OPTIONS" });
			const res = await handler(req);
			assertEquals(res.status, 204);
			assertEquals(res.headers.get("access-control-allow-origin"), "*");
			assertEquals(res.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
		});
	},
});

Deno.test({
	name: "Unknown endpoint returns 404",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (_home, handler) => {
			const { status, body } = await makeRequest(handler, "/api/v1/unknown-endpoint");
			assertEquals(status, STATUS.NotFound);
			assertEquals((body as { error: string }).error, "not found");
		});
	},
});

// =============================================================================
// Revocation Tests
// =============================================================================

Deno.test({
	name: "POST /api/v1/revoke/detail revokes a detail",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Create identity with a detail
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			// Add a detail first
			await makeRequest(
				handler,
				"/api/v1/detail",
				jsonPost({
					path: "email",
					detail: "test@example.com",
					password: "password123",
					home,
				})
			);

			// Revoke the detail
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/detail",
				jsonPost({
					path: "email",
					reason: "Changed email address",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { ok: boolean; path: string; revoked: boolean };
			assertEquals(b.ok, true);
			assertEquals(b.path, "email");
			assertEquals(b.revoked, true);
		});
	},
});

Deno.test({
	name: "POST /api/v1/revoke/detail rejects non-existent detail",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/detail",
				jsonPost({
					path: "nonexistent",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.NotFound);
			assertStringIncludes((body as { error: string }).error, "not found");
		});
	},
});

Deno.test({
	name: "POST /api/v1/revoke/detail rejects wrong password",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			// Add a detail first
			await makeRequest(
				handler,
				"/api/v1/detail",
				jsonPost({
					path: "email",
					detail: "test@example.com",
					password: "password123",
					home,
				})
			);

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/detail",
				jsonPost({
					path: "email",
					password: "wrongpassword",
					home,
				})
			);
			assertEquals(status, STATUS.Unauthorized);
		});
	},
});

Deno.test({
	name: "POST /api/v1/revoke/identity revokes the identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			const identity = await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/identity",
				jsonPost({
					reason: "Key compromised",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			const b = body as { ok: boolean; revoked: boolean; fingerprint: string };
			assertEquals(b.ok, true);
			assertEquals(b.revoked, true);
			assertEquals(b.fingerprint, identity.toFingerprint());
		});
	},
});

Deno.test({
	name: "POST /api/v1/revoke/identity rejects already revoked identity",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			// Revoke once
			await makeRequest(
				handler,
				"/api/v1/revoke/identity",
				jsonPost({
					reason: "First revocation",
					password: "password123",
					home,
				})
			);

			// Try to revoke again
			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/identity",
				jsonPost({
					reason: "Second revocation",
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.Conflict);
			assertStringIncludes((body as { error: string }).error, "already revoked");
		});
	},
});

Deno.test({
	name: "GET /api/v1/identity/public includes revocation status",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			// Add a detail
			await makeRequest(
				handler,
				"/api/v1/detail",
				jsonPost({
					path: "email",
					detail: "test@example.com",
					password: "password123",
					home,
				})
			);

			// Revoke the detail
			await makeRequest(
				handler,
				"/api/v1/revoke/detail",
				jsonPost({
					path: "email",
					password: "password123",
					home,
				})
			);

			// Check public data includes revocation info
			const { status, body } = await makeRequest(handler, `/api/v1/identity/public?home=${encodeURIComponent(home)}`);
			assertEquals(status, STATUS.OK);
			const b = body as { available: boolean; revoked: boolean; revokedDetails: string[] };
			assertEquals(b.available, true);
			assertEquals(b.revoked, false); // Identity itself not revoked
			assert(Array.isArray(b.revokedDetails));
			assert(b.revokedDetails.includes("email"));
		});
	},
});

Deno.test({
	name: "POST /api/v1/revoke/emergency-cert generates emergency certificate",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			await createTestIdentity(home, "test", "password123");
			await writeState(`${home}/.ebp`, { currentIdentity: "test" });

			const { status, body } = await makeRequest(
				handler,
				"/api/v1/revoke/emergency-cert",
				jsonPost({
					password: "password123",
					home,
				})
			);
			assertEquals(status, STATUS.OK);
			
			const b = body as { 
				type: string; 
				version: number; 
				fingerprint: string; 
				certificate: string;
				createdAt: string;
				warning: string;
			};
			assertEquals(b.type, "ebp-emergency-revocation-certificate");
			assertEquals(b.version, 1);
			assert(typeof b.fingerprint === "string");
			assert(typeof b.certificate === "string");
			assert(b.certificate.length > 0);
			assert(typeof b.createdAt === "string");
			assertStringIncludes(b.warning, "KEEP THIS SECURE");
		});
	},
});

// =============================================================================
// Server Identities / Search Tests
// =============================================================================

Deno.test({
	name: "GET /api/v1/server/identities returns error when no server configured",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Don't configure a server
			const { status, body } = await makeRequest(
				handler,
				`/api/v1/server/identities?home=${encodeURIComponent(home)}`
			);
			assertEquals(status, STATUS.BadRequest);
			assertStringIncludes((body as { error: string }).error, "server not configured");
		});
	},
});

Deno.test({
	name: "GET /api/v1/server/identities with query param passes through to search endpoint",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withTestEnv(async (home, handler) => {
			// Configure a fake server that will fail
			await writeState(`${home}/.ebp`, { currentIdentity: "test", server: "http://127.0.0.1:59999" });
			
			// The request should fail because the server isn't reachable,
			// but it verifies the endpoint accepts the query parameter
			const { status, body } = await makeRequest(
				handler,
				`/api/v1/server/identities?home=${encodeURIComponent(home)}&query=test`
			);
			// Should get a bad gateway or internal error because server is unreachable
			assert(status === 500 || status === 502, `Expected 500 or 502, got ${status}`);
			assert(typeof (body as { error: string }).error === "string");
		});
	},
});