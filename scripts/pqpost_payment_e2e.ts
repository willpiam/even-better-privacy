#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-sys=hostname
// Interactive live test: checkout is paid by a user-controlled testnet wallet.
// It never signs blockchain transactions or sends messages.
import {
  buildMailPaymentOrderDetail,
  MAIL_PAYMENT_ORDER_PATH,
} from "../common/MailUsername.ts";
import {
  createIdentityPayload,
  createSignedProof,
} from "../server/tests/helpers.ts";
import {
  loadEnvFile,
  type MailTestConfig,
  readMailTestConfig,
  TEST_MAIL_DOMAIN,
} from "./pqpost_mail_e2e.ts";

const LOCAL_SERVER = "http://127.0.0.1:8789";
const TEST_NETWORKS = new Set(["ethereum-sepolia", "cardano-preview"]);
type Api = (path: string, init?: RequestInit) => Promise<Response>;

/** Fail before any mutation if the server or advertised assets are not isolated. */
export async function verifyPaymentTestTarget(
  api: Api,
  mailHost: string,
  network: string,
  asset: string,
): Promise<void> {
  if (!TEST_NETWORKS.has(network)) {
    throw new Error("Only Ethereum Sepolia and Cardano Preview are permitted.");
  }
  const signup = await api("/api/v1/mail/signup/config");
  if (!signup.ok) throw new Error("Unable to read test signup configuration.");
  const mail = await signup.json();
  if (
    mail.enabled !== true || mail.domain !== TEST_MAIL_DOMAIN ||
    mail.imap?.host !== mailHost || mail.imap?.port !== 993 ||
    mail.imap?.secure !== true ||
    mail.smtp?.host !== mailHost || mail.smtp?.port !== 465 ||
    mail.smtp?.secure !== true
  ) {
    throw new Error(
      "Refusing to test: key server does not advertise the isolated test mail domain and expected transports.",
    );
  }
  const response = await api("/api/v1/mail/payment/config");
  if (!response.ok) throw new Error("Unable to read payment configuration.");
  const config = await response.json();
  if (
    config.enabled !== true || !Array.isArray(config.assets) ||
    config.assets.length === 0 ||
    !config.assets.every((entry: { network?: unknown }) =>
      typeof entry.network === "string" && TEST_NETWORKS.has(entry.network)
    ) ||
    !config.assets.some((entry: { network?: unknown; symbol?: unknown }) =>
      entry.network === network && entry.symbol === asset
    )
  ) {
    throw new Error(
      "Refusing to test: selected testnet asset is unavailable or the server advertises a non-testnet asset.",
    );
  }
}

export async function runPaymentE2e(
  config: MailTestConfig,
  network: string,
  asset: string,
  deps: {
    api?: Api;
    identityFactory?: typeof createIdentityPayload;
    wait?: () => Promise<void>;
  } = {},
): Promise<void> {
  if (
    new URL(config.keyServer).origin !== LOCAL_SERVER ||
    new URL(config.keyServer).pathname !== "/"
  ) {
    throw new Error(
      `Refusing to test: EBP_KEY_SERVER must be ${LOCAL_SERVER}.`,
    );
  }
  const api: Api = deps.api ??
    ((path, init = {}) =>
      fetch(`${LOCAL_SERVER}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }));
  const post = (path: string, body: unknown, authorized = false) =>
    api(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorized ? { "x-ebp-e2e-secret": config.secret } : {}),
      },
      body: JSON.stringify(body),
    });
  await verifyPaymentTestTarget(api, config.mailHost, network, asset);
  const { payload, fingerprint, signingKey } =
    (deps.identityFactory ?? createIdentityPayload)();
  const identityResponse = await post("/api/v1/identity", payload);
  if (!identityResponse.ok) {
    throw new Error(
      `Test identity publication failed (HTTP ${identityResponse.status}).`,
    );
  }
  await identityResponse.body?.cancel();
  let username = "";
  let orderId = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    username = `e2e${
      String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(
        5,
        "0",
      )
    }`;
    const detail = buildMailPaymentOrderDetail(
      `${username}@${TEST_MAIL_DOMAIN}`,
      network,
      asset,
    );
    const proof = createSignedProof(signingKey, {
      nonce: attempt,
      path: MAIL_PAYMENT_ORDER_PATH,
      detail,
      timestamp: Date.now(),
    }).proof;
    const order = await post("/api/v1/mail/payment/order", {
      fingerprint,
      username,
      network,
      asset,
      proof,
    }, true);
    const body = await order.json();
    if (order.status === 409) continue;
    if (!order.ok || typeof body.orderId !== "string") {
      throw new Error(`Test order failed: ${body.error ?? order.status}`);
    }
    orderId = body.orderId;
    break;
  }
  if (!orderId) throw new Error("Could not reserve a test address.");
  console.log(`Test address: ${username}@${TEST_MAIL_DOMAIN}`);
  console.log(
    `Open this local testnet checkout, pay with test funds, and submit the transaction ID:\n${LOCAL_SERVER}/checkout.html#${orderId}`,
  );
  let lastStatus = "";
  let confirmed = false;
  const deadline = Date.now() + 150 * 60_000;
  while (Date.now() < deadline) {
    const response = await post("/api/v1/mail/payment/status", { orderId });
    if (!response.ok) {
      throw new Error(
        `Payment status unavailable (HTTP ${response.status}); the order remains recoverable.`,
      );
    }
    const status = await response.json();
    if (status.status !== lastStatus) {
      console.log(`Payment: ${status.status}`);
      lastStatus = status.status;
    }
    if (status.status === "confirmed") {
      confirmed = true;
      break;
    }
    if (status.status === "expired" || status.status === "manual_review") {
      throw new Error(
        `Test order is ${status.status}; do not send another payment without review.`,
      );
    }
    await (deps.wait?.() ??
      new Promise((resolve) => setTimeout(resolve, 10_000)));
  }
  if (!confirmed) throw new Error("Timed out waiting for the testnet payment.");
  const detailProof = createSignedProof(signingKey, {
    nonce: 20,
    path: "email",
    detail: `${username}@${TEST_MAIL_DOMAIN}`,
    timestamp: Date.now(),
  }).proof;
  const mailPassword = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  let signupFailure: unknown;
  let signupFailed = false;
  try {
    const signup = await post("/api/v1/mail/signup", {
      fingerprint,
      username,
      mailPassword,
      detailProof,
    }, true);
    if (!signup.ok) {
      throw new Error(
        `Paid test mailbox creation failed (HTTP ${signup.status}).`,
      );
    }
    const body = await signup.json();
    if (body.email !== `${username}@${TEST_MAIL_DOMAIN}`) {
      throw new Error("Server returned an unexpected mailbox address.");
    }
    console.log(`Confirmed paid test mailbox creation: ${body.email}`);
  } catch (error) {
    signupFailed = true;
    signupFailure = error;
  }
  try {
    const cleanup = await post("/api/v1/mail/e2e/cleanup", {
      usernames: [username],
    }, true);
    if (!cleanup.ok) {
      throw new Error(
        `Cleanup failed for ${username}@${TEST_MAIL_DOMAIN} (HTTP ${cleanup.status}); inspect the isolated test server.`,
      );
    }
    console.log(`Cleaned up ${username}@${TEST_MAIL_DOMAIN}`);
  } catch (error) {
    if (signupFailed) {
      throw new AggregateError(
        [signupFailure, error],
        "Paid test signup and cleanup both failed.",
      );
    }
    throw error;
  }
  if (signupFailed) throw signupFailure;
}
if (import.meta.main) {
  loadEnvFile(new URL("../.env.pqpost-mail.local", import.meta.url));
  loadEnvFile(new URL("../.env", import.meta.url));
  const [network, asset] = Deno.args;
  if (Deno.args.length !== 2 || !network || !asset) {
    throw new Error(
      "Usage: deno task test:pqpost-payment <ethereum-sepolia|cardano-preview> <asset-symbol>",
    );
  }
  await runPaymentE2e(readMailTestConfig(), network, asset);
}
