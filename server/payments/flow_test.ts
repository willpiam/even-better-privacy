import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { insertIdentity } from "../db/index.ts";
import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { computeIdentityFingerprint } from "../crypto.ts";
import { createSignedProof } from "../tests/helpers.ts";
import {
  buildMailPaymentOrderDetail,
  MAIL_PAYMENT_ORDER_PATH,
  MAIL_PAYMENT_RECOVER_PATH,
} from "../../common/MailUsername.ts";
import {
  handlePaymentConfig,
  handlePaymentCreate,
  handlePaymentOrder,
  handlePaymentRecover,
  reconcilePendingPayments,
} from "../handlers/mail-payment.ts";
import {
  handleMailSignup,
  setStalwartClientForTests,
} from "../handlers/mail-signup.ts";
import { StalwartClient } from "../stalwart.ts";

Deno.test({
  name:
    "signed testnet payment binds the name and identity before mailbox fulfillment",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const recipient = `0x${"3".repeat(40)}`;
    const token = `0x${"4".repeat(40)}`;
    const env: Record<string, string> = {
      MAIL_SIGNUP_ENABLED: "true",
      MAIL_DOMAIN: "test.pqpost.com",
      MAIL_HOST: "mail.pqpost.com",
      MAIL_E2E_SECRET: "test-only-e2e-secret",
      MAIL_PAYMENT_ENABLED: "true",
      MAIL_PAYMENT_PRICES_CENTS: JSON.stringify({
        3: 600,
        4: 500,
        5: 400,
        6: 300,
        7: 200,
        8: 100,
      }),
      MAIL_PAYMENT_ASSETS: JSON.stringify([{
        network: "ethereum-sepolia",
        symbol: "USDC",
        recipient,
        unit: token,
        decimals: 6,
      }]),
      MAIL_PAYMENT_ETH_RPC_URL: "https://rpc.example",
      MAIL_PAYMENT_BLOCKFROST_KEY: "test",
      MAIL_PAYMENT_COINGECKO_KEY: "test",
    };
    const previous = Object.fromEntries(
      Object.keys(env).map((key) => [key, Deno.env.get(key)]),
    );
    const originalFetch = globalThis.fetch;
    const db = new SqliteDatabaseAdapter(":memory:");
    try {
      for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
      setStalwartClientForTests(
        new StalwartClient({
          baseUrl: "https://stalwart.test",
          token: "test",
          domainId: null,
        }),
      );
      Deno.env.set("MAIL_DOMAIN", "pqpost.com");
      assertEquals((await handlePaymentConfig().json()).enabled, false);
      Deno.env.set("MAIL_DOMAIN", "test.pqpost.com");
      const signingKey = new DilithiumSigningKey();
      const fingerprint = computeIdentityFingerprint({
        signingKeyType: "dilithium",
        encryptionKeyType: "kyber",
        signingKey: signingKey.publicKey,
        encryptionKey: "00",
      });
      await insertIdentity(db, {
        fingerprint,
        signingKeyType: "dilithium",
        encryptionKeyType: "kyber",
        signingKey: signingKey.publicKey,
        encryptionKey: "00",
        signingKeyDetails: { variant: signingKey.variant },
        encryptionKeyDetails: null,
        createdAt: Date.now(),
      });
      const proof = createSignedProof(signingKey, {
        nonce: 1,
        path: MAIL_PAYMENT_ORDER_PATH,
        detail: buildMailPaymentOrderDetail(
          "alice@test.pqpost.com",
          "ethereum-sepolia",
          "USDC",
        ),
        timestamp: Date.now(),
      }).proof;
      const post = (body: unknown, authorized = false) =>
        new Request("http://localhost/", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorized ? { "x-ebp-e2e-secret": env.MAIL_E2E_SECRET } : {}),
          },
          body: JSON.stringify(body),
        });
      const testProof = createSignedProof(signingKey, {
        nonce: 10,
        path: MAIL_PAYMENT_ORDER_PATH,
        detail: buildMailPaymentOrderDetail(
          "e2e12345@test.pqpost.com",
          "ethereum-sepolia",
          "USDC",
        ),
        timestamp: Date.now(),
      }).proof;
      const testRequest = {
        fingerprint,
        username: "e2e12345",
        network: "ethereum-sepolia",
        asset: "USDC",
        proof: testProof,
      };
      assertEquals(
        (await handlePaymentCreate(post(testRequest), db)).status,
        400,
      );
      const testOrder = await handlePaymentCreate(post(testRequest, true), db);
      assertEquals(testOrder.status, 200);
      const unpaidTestSignup = await handleMailSignup(
        post({ fingerprint, username: "e2e12345" }, true),
        db,
      );
      assertEquals(unpaidTestSignup.status, 409);
      await db.query("DELETE FROM mail_payment_orders WHERE order_id = ?", [
        (await testOrder.json()).orderId,
      ]);
      const unauthorized = await handlePaymentCreate(
        post({
          fingerprint,
          username: "bob",
          network: "ethereum-sepolia",
          asset: "USDC",
          proof,
        }),
        db,
      );
      assertEquals(unauthorized.status, 400);
      const created = await handlePaymentCreate(
        post({
          fingerprint,
          username: "alice",
          network: "ethereum-sepolia",
          asset: "USDC",
          proof,
        }),
        db,
      );
      assertEquals(created.status, 200);
      const { orderId } = await created.json();
      const replay = await handlePaymentCreate(
        post({
          fingerprint,
          username: "alice",
          network: "ethereum-sepolia",
          asset: "USDC",
          proof,
        }),
        db,
      );
      assertEquals(replay.status, 409);
      const view =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(view.email, "alice@test.pqpost.com");
      assert(!view.message.includes(orderId));
      assertEquals(view.amountAtomic, "4000000");
      const hash = `0x${"1".repeat(64)}`;
      const blockHash = `0x${"2".repeat(64)}`;
      const msg = Array.from(
        new TextEncoder().encode(view.message),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const calldata = `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${
        BigInt(view.amountAtomic).toString(16).padStart(64, "0")
      }${msg}`;
      const transaction = {
        hash,
        to: token,
        value: "0x0",
        input: calldata,
        blockHash,
        blockNumber: "0xa",
      };
      const receipt = {
        transactionHash: hash,
        blockHash,
        blockNumber: "0xa",
        status: "0x1",
        logs: [{
          address: token,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            `0x${"0".repeat(64)}`,
            `0x${recipient.slice(2).padStart(64, "0")}`,
          ],
          data: `0x${BigInt(view.amountAtomic).toString(16).padStart(64, "0")}`,
        }],
      };
      let latestBlock = "0xa";
      globalThis.fetch = ((_url: unknown, init?: { body?: unknown }) => {
        const request = JSON.parse(String(init?.body));
        const results: Record<string, unknown> = {
          eth_chainId: "0xaa36a7",
          eth_getTransactionByHash: transaction,
          eth_getTransactionReceipt: receipt,
          eth_blockNumber: latestBlock,
          eth_getBlockByNumber: { hash: blockHash },
        };
        return Promise.resolve(
          Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: results[request.method],
          }),
        );
      }) as typeof fetch;
      const verified = await handlePaymentOrder(
        post({ orderId, transactionId: hash }),
        db,
        true,
      );
      assertEquals(verified.status, 200);
      assertEquals((await verified.json()).status, "pending");
      latestBlock = "0xe";
      await reconcilePendingPayments(db);
      assertEquals(
        (await (await handlePaymentOrder(post({ orderId }), db, false)).json())
          .status,
        "confirmed",
      );
      const recoveryProof = createSignedProof(signingKey, {
        nonce: 2,
        path: MAIL_PAYMENT_RECOVER_PATH,
        detail: "alice@test.pqpost.com",
        timestamp: Date.now(),
      }).proof;
      const recovered = await handlePaymentRecover(
        post({ fingerprint, username: "alice", proof: recoveryProof }),
        db,
      );
      assertEquals((await recovered.json()).orderId, orderId);
      const wrongRecovery = await handlePaymentRecover(
        post({ fingerprint, username: "bobby", proof: recoveryProof }),
        db,
      );
      assertEquals(wrongRecovery.status, 400);
      let failCreate = true;
      const stalwartFetch = ((_url: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body));
        const [method, args] = body.methodCalls[0];
        const result = method === "x:Domain/get"
          ? { list: [{ id: "d1", name: "test.pqpost.com" }] }
          : args.create
          ? failCreate
            ? { notCreated: { new1: { type: "serverFail" } } }
            : { created: { new1: { id: "account" } } }
          : {};
        return Promise.resolve(
          Response.json({ methodResponses: [[method, result, "c1"]] }),
        );
      }) as typeof fetch;
      setStalwartClientForTests(
        new StalwartClient({
          baseUrl: "https://stalwart.test",
          token: "test",
          domainId: null,
        }, stalwartFetch),
      );
      const emailProof = createSignedProof(signingKey, {
        nonce: 2,
        path: "email",
        detail: "alice@test.pqpost.com",
        timestamp: Date.now(),
      }).proof;
      const wrong = await handleMailSignup(
        post({
          fingerprint,
          username: "mallory",
          mailPassword: "x".repeat(32),
          detailProof: emailProof,
        }),
        db,
      );
      assertEquals(wrong.status, 409);
      const differentFreeName = await handleMailSignup(
        post({
          fingerprint,
          username: "longfreename",
          mailPassword: "x".repeat(32),
          detailProof: emailProof,
        }),
        db,
      );
      assertEquals(differentFreeName.status, 409);
      const failed = await handleMailSignup(
        post({
          fingerprint,
          username: "alice",
          mailPassword: "x".repeat(32),
          detailProof: emailProof,
        }),
        db,
      );
      assertEquals(failed.status, 502);
      assertEquals(
        (await (await handlePaymentOrder(post({ orderId }), db, false)).json())
          .status,
        "confirmed",
      );
      failCreate = false;
      const signup = await handleMailSignup(
        post({
          fingerprint,
          username: "alice",
          mailPassword: "x".repeat(32),
          detailProof: emailProof,
        }),
        db,
      );
      const body = await signup.json();
      assertEquals(signup.status, 200, JSON.stringify(body));
      assertEquals(body.email, "alice@test.pqpost.com");
      assertEquals(
        (await (await handlePaymentOrder(post({ orderId }), db, false)).json())
          .status,
        "fulfilled",
      );
      assert(
        (await db.query(
          "SELECT order_id FROM mail_payment_orders WHERE status = 'fulfilled'",
        )).length === 1,
      );
    } finally {
      globalThis.fetch = originalFetch;
      setStalwartClientForTests(null);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
      await db.close();
    }
  },
});

Deno.test({
  name:
    "reserved short test addresses still require both payment and the test secret",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const {
      reservePaymentOrder,
      submitPaymentTransaction,
      confirmPaymentOrder,
    } = await import("./orders.ts");
    const saved = Object.fromEntries(
      ["MAIL_SIGNUP_ENABLED", "MAIL_DOMAIN", "MAIL_E2E_SECRET"].map((
        key,
      ) => [key, Deno.env.get(key)]),
    );
    const db = new SqliteDatabaseAdapter(":memory:");
    try {
      Deno.env.set("MAIL_SIGNUP_ENABLED", "true");
      Deno.env.set("MAIL_DOMAIN", "test.pqpost.com");
      Deno.env.set("MAIL_E2E_SECRET", "test-only-e2e-secret");
      const signingKey = new DilithiumSigningKey();
      const fingerprint = computeIdentityFingerprint({
        signingKeyType: "dilithium",
        encryptionKeyType: "kyber",
        signingKey: signingKey.publicKey,
        encryptionKey: "00",
      });
      await insertIdentity(db, {
        fingerprint,
        signingKeyType: "dilithium",
        encryptionKeyType: "kyber",
        signingKey: signingKey.publicKey,
        encryptionKey: "00",
        signingKeyDetails: { variant: signingKey.variant },
        encryptionKeyDetails: null,
        createdAt: Date.now(),
      });
      const now = Date.now();
      const orderId = crypto.randomUUID();
      assertEquals(
        await reservePaymentOrder(db, {
          orderId,
          username: "e2e12345",
          domain: "test.pqpost.com",
          fingerprint,
          proofNonce: 0,
          asset: "USDC",
          network: "ethereum-sepolia",
          recipient: "test",
          assetUnit: "test",
          usdCents: 100,
          amountAtomic: "1000000",
          decimals: 6,
          usdPerToken: "1",
          confirmations: 5,
          message: "test",
          createdAt: now,
          expiresAt: now + 60000,
          graceUntil: now + 120000,
        }, now),
        true,
      );
      const fetchFake = ((_url: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body));
        const [method, args] = body.methodCalls[0];
        const result = method === "x:Domain/get"
          ? { list: [{ id: "d1", name: "test.pqpost.com" }] }
          : args.create
          ? { created: { new1: { id: "account" } } }
          : {};
        return Promise.resolve(
          Response.json({ methodResponses: [[method, result, "c1"]] }),
        );
      }) as typeof fetch;
      setStalwartClientForTests(
        new StalwartClient({
          baseUrl: "https://stalwart.test",
          token: "test",
          domainId: null,
        }, fetchFake),
      );
      const proof = createSignedProof(signingKey, {
        nonce: 1,
        path: "email",
        detail: "e2e12345@test.pqpost.com",
        timestamp: now,
      }).proof;
      const signup = (secret: boolean) =>
        handleMailSignup(
          new Request("http://localhost/", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(secret ? { "x-ebp-e2e-secret": "test-only-e2e-secret" } : {}),
            },
            body: JSON.stringify({
              fingerprint,
              username: "e2e12345",
              mailPassword: "x".repeat(32),
              detailProof: proof,
            }),
          }),
          db,
        );
      assertEquals((await signup(true)).status, 409);
      assertEquals(
        await submitPaymentTransaction(
          db,
          orderId,
          fingerprint,
          "a".repeat(64),
          now,
        ),
        true,
      );
      assertEquals(
        await confirmPaymentOrder(db, orderId, "a".repeat(64), now),
        true,
      );
      assertEquals((await signup(false)).status, 400);
      const result = await signup(true);
      assertEquals(result.status, 200, await result.clone().text());
      assertEquals((await result.json()).email, "e2e12345@test.pqpost.com");
    } finally {
      setStalwartClientForTests(null);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
      await db.close();
    }
  },
});
