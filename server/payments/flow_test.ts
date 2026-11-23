import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import {
  getDetailRecord,
  getMailboxByFingerprint,
  insertIdentity,
} from "../db/index.ts";
import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { computeIdentityFingerprint } from "../crypto.ts";
import { createSignedProof } from "../tests/helpers.ts";
import {
  buildMailPaymentOrderDetail,
  MAIL_PAYMENT_CANCEL_PATH,
  MAIL_PAYMENT_ORDER_PATH,
  MAIL_PAYMENT_RECOVER_PATH,
} from "../../common/MailUsername.ts";
import {
  handlePaymentCancel,
  handlePaymentConfig,
  handlePaymentCreate,
  handlePaymentOrder,
  handlePaymentRecover,
  handlePaymentRestart,
  handlePaymentSelect,
  reconcilePendingPayments,
} from "../handlers/mail-payment.ts";
import {
  handleMailE2eCleanup,
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
      ETHEREUM_ALCHEMY_API_KEY: "test",
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
        nonce: 12,
        path: MAIL_PAYMENT_ORDER_PATH,
        detail: buildMailPaymentOrderDetail(
          "alice@test.pqpost.com",
          "",
          "",
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
      const unpaidId = (await testOrder.json()).orderId;
      const authorization = createSignedProof(signingKey, {
        nonce: 11,
        path: MAIL_PAYMENT_CANCEL_PATH,
        detail: unpaidId,
        timestamp: Date.now(),
      }).proof;
      const cancel = (orderId: string, proof?: string) =>
        handlePaymentCancel(post({ orderId, confirmUnpaid: true, proof }), db);
      assertEquals((await cancel(unpaidId)).status, 403);
      assertEquals((await cancel(crypto.randomUUID(), authorization)).status, 404);
      assertEquals((await cancel(unpaidId, authorization)).status, 200);
      assertEquals((await cancel(unpaidId, authorization)).status, 403);
      const cancelledView =
        await (await handlePaymentOrder(post({ orderId: unpaidId }), db, false)).json();
      const unauthorized = await handlePaymentCreate(
        post({
          fingerprint,
          username: "bob",
          network: "",
          asset: "",
          proof,
        }),
        db,
      );
      assertEquals(unauthorized.status, 400);
      const created = await handlePaymentCreate(
        post({
          fingerprint,
          username: "alice",
          network: "",
          asset: "",
          proof,
        }),
        db,
      );
      assertEquals(created.status, 200);
      const { orderId } = await created.json();
      assertEquals((await cancel(orderId, authorization)).status, 403);
      const replay = await handlePaymentCreate(
        post({
          fingerprint,
          username: "alice",
          network: "",
          asset: "",
          proof,
        }),
        db,
      );
      assertEquals(replay.status, 400);
      const unquoted =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(unquoted.paymentAssets, [
        { network: "ethereum-sepolia", symbol: "USDC" },
      ]);
      assertEquals(unquoted.amountAtomic, undefined);
      assertEquals(
        (await handlePaymentOrder(post({ orderId, transactionId: "1".repeat(64) }), db, true)).status,
        409,
      );
      assertEquals(
        (await handlePaymentSelect(post({ orderId, network: "ethereum-mainnet", asset: "USDC" }), db)).status,
        400,
      );
      const preview = await handlePaymentSelect(
        post({ orderId, network: "ethereum-sepolia", asset: "USDC", preview: true }),
        db,
      );
      assertEquals(preview.status, 200);
      assertEquals((await preview.json()).amountAtomic, "4000000");
      const afterPreview =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(afterPreview.paymentAssets, unquoted.paymentAssets);
      await db.query("UPDATE mail_payment_orders SET grace_until = ? WHERE order_id = ?", [
        Date.now() - 1000, orderId,
      ]);
      const expired = await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals([expired.status, expired.canRestart], ["expired", true]);
      const restart = (paymentReference: string) =>
        handlePaymentRestart(post({ orderId, paymentReference }), db);
      assertEquals((await restart(expired.message)).status, 200);
      const renewed = await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(renewed.paymentAssets, unquoted.paymentAssets);
      assert(renewed.message !== expired.message);
      const select = () => handlePaymentSelect(
        post({ orderId, network: "ethereum-sepolia", asset: "USDC" }),
        db,
      );
      const selections = await Promise.all([select(), select()]);
      assertEquals(selections.map(({ status }) => status).sort(), [200, 409]);
      const firstQuote =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(firstQuote.canRestart, false);
      assertEquals(firstQuote.expiresAt > Date.now(), true);
      assertEquals((await restart(firstQuote.message)).status, 409);
      const view =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(view.email, "alice@test.pqpost.com");
      assert(!view.message.includes(orderId));
      assertEquals(view.message, firstQuote.message);
      assertEquals(view.amountAtomic, "4000000");
      assertEquals(
        (await handlePaymentOrder(post({
          orderId,
          paymentReference: expired.message,
          transactionId: "1".repeat(64),
        }), db, true)).status,
        409,
      );
      const hash = `0x${"1".repeat(64)}`;
      const replacedHash = `0x${"5".repeat(64)}`;
      const lateHash = `0x${"7".repeat(64)}`;
      const blockHash = `0x${"2".repeat(64)}`;
      const messageHex = (message: string) => Array.from(
        new TextEncoder().encode(message),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const transfer = `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${
        BigInt(view.amountAtomic).toString(16).padStart(64, "0")
      }`;
      const transaction = {
        hash,
        to: token,
        value: "0x0",
        input: transfer + messageHex(view.message),
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
      let latestBlock = "0xd";
      let replacementVisible = false;
      let holdReplacedHash = false;
      let abortedLookup = false;
      const calls = new Map<string, number>();
      const olderLookup = Promise.withResolvers<Response>();
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        calls.set(request.method, (calls.get(request.method) ?? 0) + 1);
        const isOriginal = request.params.includes(hash);
        const isLate = request.params.includes(lateHash);
        const lookupHash = isOriginal ? hash : isLate ? lateHash : replacedHash;
        const found = isOriginal || isLate || replacementVisible;
        if (
          holdReplacedHash && !isOriginal &&
          request.method === "eth_getTransactionByHash"
        ) {
          init?.signal?.addEventListener("abort", () => {
            abortedLookup = true;
            olderLookup.reject(init.signal?.reason);
          }, { once: true });
          return olderLookup.promise;
        }
        const results: Record<string, unknown> = {
          eth_chainId: "0xaa36a7",
          eth_getTransactionByHash: found
            ? {
              ...transaction,
              hash: lookupHash,
              input: isLate ? transfer + messageHex(cancelledView.message) : transaction.input,
            }
            : null,
          eth_getTransactionReceipt: found ? { ...receipt, transactionHash: lookupHash } : null,
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
      const notYetVisible = await handlePaymentOrder(
        post({ orderId, transactionId: replacedHash }),
        db,
        true,
      );
      assertEquals(notYetVisible.status, 409);
      assertEquals((await notYetVisible.json()).retryPayment, true);
      const unchanged = await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals([unchanged.status, unchanged.transactionId], ["quoted", null]);
      replacementVisible = true;
      const verified = await handlePaymentOrder(
        post({ orderId, transactionId: replacedHash }), db, true,
      );
      assertEquals(verified.status, 200);
      const waiting = await verified.json();
      assertEquals(waiting.status, "pending");
      assertEquals(waiting.confirmationsSeen, 4);
      assertEquals((await restart(view.message)).status, 409);
      // Toggling the catalog off must not pause verification of stored quotes.
      Deno.env.set("MAIL_PAYMENT_ENABLED", "false");
      Deno.env.delete("MAIL_PAYMENT_BLOCKFROST_KEY");
      Deno.env.delete("ETHEREUM_ALCHEMY_API_KEY");
      assertEquals((await handlePaymentConfig().json()).enabled, false);
      const replacement = await handlePaymentOrder(
        post({ orderId, transactionId: hash }),
        db,
        true,
      );
      assertEquals(replacement.status, 200);
      assertEquals((await replacement.json()).status, "pending");
      latestBlock = "0xe";
      holdReplacedHash = true;
      calls.clear();
      const reconciliation = reconcilePendingPayments(db);
          let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const completed = await Promise.race([
          reconciliation.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
        assertEquals(
          completed,
          true,
          "the verified hash must not wait for the old lookup",
        );
        assertEquals(abortedLookup, true);
        assertEquals(calls.get("eth_chainId"), 1);
        assertEquals(calls.get("eth_blockNumber"), 1);
      } finally {
        clearTimeout(timer);
        olderLookup.reject(new Error("fixture cleanup"));
        await reconciliation;
      }
      const finalPayment =
        await (await handlePaymentOrder(post({ orderId }), db, false)).json();
      assertEquals(finalPayment.status, "confirmed");
      assertEquals(finalPayment.transactionId, hash.slice(2));
      holdReplacedHash = false;
      const latePayment = await handlePaymentOrder(
        post({ orderId: unpaidId, transactionId: lateHash }), db, true,
      );
      assertEquals(latePayment.status, 200);
      const review = await latePayment.json();
      assertEquals([review.status, review.transactionId], ["manual_review", lateHash.slice(2)]);
      const recoveryProof = createSignedProof(signingKey, {
        nonce: 13,
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
      let dropCreationReply = false;
      let failLookup = false;
      let createInWrongDomain = false;
      let remoteAccount: Record<string, unknown> | undefined;
      const passwordUpdates: string[] = [];
      const stalwartFetch = ((_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const [method, args] = body.methodCalls[0];
        let result: Record<string, unknown> = {};
        if (method === "x:Domain/get") {
          const domains = [
            { id: "primary", name: "pqpost.com" },
            { id: "d1", name: "test.pqpost.com" },
          ];
          result = { list: domains.filter(domain => !args.ids || args.ids.includes(domain.id)) };
        } else if (method === "x:Account/query") {
          assertEquals(args.filter.conditions, [{ name: "alice" }, {
            domainId: "d1",
          }]);
          if (failLookup) {
            return Promise.resolve(new Response(null, { status: 503 }));
          }
          result = { ids: remoteAccount ? ["account"] : [] };
        } else if (method === "x:Account/get") {
          result = { list: remoteAccount ? [remoteAccount] : [] };
        } else if (args.create) {
          assertEquals(args.create.new1.domainId, "d1");
          if (failCreate || remoteAccount) {
            result = {
              notCreated: {
                new1: { type: failCreate ? "serverFail" : "alreadyExists" },
              },
            };
          } else {
            remoteAccount = {
              ...args.create.new1,
              id: "account",
              domainId: createInWrongDomain ? "primary" : args.create.new1.domainId,
            };
            if (dropCreationReply) {
              return Promise.reject(new Error("creation response lost"));
            }
            result = { created: { new1: { id: "account" } } };
          }
        } else if (args.update) {
          passwordUpdates.push(args.update.account.credentials["0"].secret);
          result = { updated: { account: null } };
        }
        return Promise.resolve(
          Response.json({ methodResponses: [[method, result, "c1"]] }),
        );
      }) as typeof fetch;
      setStalwartClientForTests(
        new StalwartClient({
          baseUrl: "https://stalwart.test",
          token: "test",
          domainId: "primary",
        }, stalwartFetch),
      );
      const emailProof = createSignedProof(signingKey, {
        nonce: 14,
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
      const signupRequest = (mailPassword = "x".repeat(32)) =>
        post({
          fingerprint,
          username: "alice",
          mailPassword,
          detailProof: emailProof,
        });

      remoteAccount = {
        id: "account",
        "@type": "User",
        name: "alice",
        domainId: "d1",
        description: "different owner",
      };
      assertEquals((await handleMailSignup(signupRequest(), db)).status, 409);
      assertEquals(passwordUpdates, []);
      assertEquals(await getMailboxByFingerprint(db, fingerprint), null);

      remoteAccount = undefined;
      createInWrongDomain = true;
      assertEquals((await handleMailSignup(signupRequest(), db)).status, 502);
      assertEquals((await getMailboxByFingerprint(db, fingerprint))?.stalwartId, null);
      assertEquals((await handleMailSignup(signupRequest(), db)).status, 409);
      assertEquals(passwordUpdates, []);
      assertEquals(await getDetailRecord(db, fingerprint, "email"), null);
      assertEquals(
        (await (await handlePaymentOrder(post({ orderId }), db, false)).json()).status,
        "confirmed",
      );

      remoteAccount = undefined;
      createInWrongDomain = false;
      dropCreationReply = true;
      failLookup = true;
      assertEquals((await handleMailSignup(signupRequest(), db)).status, 502);
      assertEquals(
        (await getMailboxByFingerprint(db, fingerprint))?.stalwartId,
        null,
      );
      failLookup = false;
      await db.execute(`CREATE TRIGGER fail_payment_fulfillment
        BEFORE UPDATE OF status ON mail_payment_orders WHEN NEW.status = 'fulfilled'
        BEGIN SELECT RAISE(ABORT, 'simulated payment write failure'); END`);
      const failedFulfillment = await handleMailSignup(
        post({
          fingerprint,
          username: "alice",
          mailPassword: "x".repeat(32),
          detailProof: emailProof,
        }),
        db,
      );
      assertEquals(failedFulfillment.status, 500);
      assertEquals(
        (await getMailboxByFingerprint(db, fingerprint))?.stalwartId,
        null,
      );
      assertEquals(await getDetailRecord(db, fingerprint, "email"), null);
      await db.execute("DROP TRIGGER fail_payment_fulfillment");
      const retryPassword = "r".repeat(32);
      const signup = await handleMailSignup(signupRequest(retryPassword), db);
      assertEquals(passwordUpdates, ["x".repeat(32), retryPassword]);
      const body = await signup.json();
      assertEquals(signup.status, 200, JSON.stringify(body));
      assertEquals(body.email, "alice@test.pqpost.com");
      assertEquals(
        (await (await handlePaymentOrder(post({ orderId }), db, false)).json())
          .status,
        "fulfilled",
      );
      assertEquals(
        await db.query(
          "SELECT order_id FROM mail_payment_orders WHERE status = 'fulfilled' AND active = 0",
        ),
        [[orderId]],
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
      getPaymentOrder,
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
      let account: Record<string, unknown> | undefined;
      const fetchFake = ((_url: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body));
        const [method, args] = body.methodCalls[0];
        let result: Record<string, unknown> = {};
        if (method === "x:Domain/get") {
          result = { list: [{ id: "d1", name: "test.pqpost.com" }] };
        } else if (args.create) {
          account = { ...args.create.new1, id: "account" };
          result = { created: { new1: { id: "account" } } };
        } else if (method === "x:Account/get") {
          result = { list: account ? [account] : [] };
        }
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
      const cleanup = await handleMailE2eCleanup(
        new Request("http://localhost/", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ebp-e2e-secret": "test-only-e2e-secret",
          },
          body: JSON.stringify({ usernames: ["e2e12345"] }),
        }),
        db,
      );
      assertEquals(cleanup.status, 200);
      assertEquals(await getMailboxByFingerprint(db, fingerprint), null);
      const fulfilledOrder = (await getPaymentOrder(db, orderId))!;
      assertEquals(fulfilledOrder.status, "fulfilled");
      assertEquals(fulfilledOrder.active, false);
      assertEquals(
        await reservePaymentOrder(db, {
          ...fulfilledOrder,
          orderId: crypto.randomUUID(),
          proofNonce: 2,
        }, now),
        true,
      );
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

Deno.test("free signup rechecks paid reservations under the identity lock", async () => {
  const env = { MAIL_SIGNUP_ENABLED: "true", MAIL_DOMAIN: "test.pqpost.com" };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const db = new SqliteDatabaseAdapter(":memory:");
  const afterPreflight = Promise.withResolvers<void>();
  const continueSignup = Promise.withResolvers<void>();
  const pausingDb = {
    query: async <T extends unknown[]>(
      sql: string,
      params?: import("../db/adapter.ts").DatabaseQueryParams,
    ) => {
      const rows = await db.query<T>(sql, params);
      if (
        sql.startsWith(
          "SELECT order_id FROM mail_payment_orders WHERE identity_fingerprint",
        )
      ) {
        assertEquals(rows.length, 0);
        afterPreflight.resolve();
        await continueSignup.promise;
      }
      return rows;
    },
    execute: db.execute.bind(db),
    close: db.close.bind(db),
    writeTransaction: db.writeTransaction.bind(db),
  };
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    setStalwartClientForTests(
      new StalwartClient({
        baseUrl: "https://stalwart.test",
        token: "fixture",
        domainId: "test",
      }, () =>
        Promise.reject(
          new Error("A conflicting signup must never provision a mailbox."),
        )),
    );
    const signingKey = new DilithiumSigningKey();
    const keys = {
      signingKeyType: "dilithium",
      encryptionKeyType: "kyber",
      signingKey: signingKey.publicKey,
      encryptionKey: "00",
    } as const;
    const fingerprint = computeIdentityFingerprint(keys);
    const now = Date.now();
    await insertIdentity(db, {
      ...keys,
      fingerprint,
      signingKeyDetails: { variant: signingKey.variant },
      encryptionKeyDetails: null,
      createdAt: now,
    });
    const detailProof = createSignedProof(signingKey, {
      nonce: 1,
      path: "email",
      detail: "longfreename@test.pqpost.com",
      timestamp: now,
    }).proof;
    const signup = handleMailSignup(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          username: "longfreename",
          mailPassword: "x".repeat(32),
          detailProof,
        }),
      }),
      pausingDb,
    );
    await afterPreflight.promise;
    const { reservePaymentOrder } = await import("./orders.ts");
    assertEquals(
      await db.writeTransaction((tx) =>
        reservePaymentOrder(tx, {
          orderId: crypto.randomUUID(),
          username: "alice",
          domain: "test.pqpost.com",
          fingerprint,
          proofNonce: 0,
          asset: "USDC",
          network: "ethereum-sepolia",
          recipient: `0x${"1".repeat(40)}`,
          assetUnit: `0x${"2".repeat(40)}`,
          usdCents: 100,
          decimals: 6,
          usdPerToken: "1",
          amountAtomic: "1000000",
          confirmations: 5,
          message: "fixture",
          createdAt: now,
          expiresAt: now + 60_000,
          graceUntil: now + 120_000,
        }, now), `identity:${fingerprint}`),
      true,
    );
    continueSignup.resolve();
    const response = await signup;
    assertEquals(response.status, 409);
    assertEquals(
      (await response.json()).error,
      "this identity has an active address purchase",
    );
    assertEquals(await getMailboxByFingerprint(db, fingerprint), null);
  } finally {
    continueSignup.resolve();
    setStalwartClientForTests(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    await db.close();
  }
});
