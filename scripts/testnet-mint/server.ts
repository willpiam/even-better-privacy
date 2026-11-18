import {
  Blockfrost,
  CML,
  Lucid,
  mintingPolicyToId,
  paymentCredentialOf,
  scriptFromNative,
  toUnit,
} from "@lucid-evolution/lucid";
import {
  bech32Address,
  PREVIEW_BLOCKFROST_URL,
  selectWalletUtxos,
  utxoFromCip30,
} from "../../server/payments/cardano_tx.ts";
import {
  atomicAmount,
  DECIMALS,
  PREVIEW_SYMBOLS,
  SEPOLIA_SYMBOLS,
} from "./assets.ts";

const host = "127.0.0.1:8790";
const origin = `http://${host}`;
const cbor = /^(?:[0-9a-f]{2})+$/i;
const headers = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

async function compileContract(): Promise<string> {
  const { default: solc } = await import("npm:solc@0.8.24");
  const filename = "TestStablecoin.sol";
  const source = await Deno.readTextFile(
    new URL(`../contracts/${filename}`, import.meta.url),
  );
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { [filename]: { content: source } },
    settings: { outputSelection: { "*": { "*": ["evm.bytecode.object"] } } },
  })));
  const bytecode = result.contracts?.[filename]?.TestStablecoin?.evm?.bytecode
    ?.object;
  if (typeof bytecode !== "string" || !cbor.test(bytecode)) {
    console.error(result.errors);
    throw new Error(
      "Could not compile the Sepolia test token. Check the terminal.",
    );
  }
  return `0x${bytecode}`;
}

function checkedCbor(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" || value.length > maxLength || !cbor.test(value)
  ) {
    throw new Error("The wallet returned invalid Cardano transaction data.");
  }
  return value;
}

function previewProjectId(): string {
  const projectId = Deno.env.get("MAIL_TEST_PAYMENT_BLOCKFROST_KEY")?.trim();
  if (!projectId?.startsWith("preview")) {
    throw new Error(
      "Start the local server with a Preview Blockfrost project ID.",
    );
  }
  return projectId;
}

async function previewConfirmed(hash: unknown): Promise<boolean> {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("Invalid Preview transaction hash.");
  }
  const response = await fetch(`${PREVIEW_BLOCKFROST_URL}/txs/${hash}`, {
    headers: { project_id: previewProjectId() },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("Blockfrost could not look up the mint.");
  return (await response.json()).valid_contract === true;
}

async function buildPreview(body: Record<string, unknown>) {
  const projectId = previewProjectId();
  const amount = atomicAmount(String(body.amount));
  const address = bech32Address(checkedCbor(body.changeAddress, 256));
  if (!address.startsWith("addr_test1")) {
    throw new Error("Switch your Cardano wallet to Preview.");
  }
  if (
    !Array.isArray(body.utxos) || !body.utxos.length || body.utxos.length > 256
  ) {
    throw new Error("Use a funded Preview wallet with at most 256 UTxOs.");
  }
  const walletUtxos = body.utxos.map((hex) =>
    utxoFromCip30(checkedCbor(hex, 16_000))
  );
  const provider = new Blockfrost(PREVIEW_BLOCKFROST_URL, projectId);
  const candidates = selectWalletUtxos(walletUtxos);
  // CIP-30 uses network ID 0 for both Preview and Preprod. Resolve the
  // wallet inputs against Preview and use the on-chain amounts and addresses.
  const confirmed = await provider.getUtxosByOutRef(
    candidates.map(({ txHash, outputIndex }) => ({
      txHash,
      outputIndex,
    })),
  );
  if (!confirmed.length) {
    throw new Error(
      "The wallet has no confirmed Preview inputs. Check Preview mode and fund it with tADA.",
    );
  }
  const signer = paymentCredentialOf(address);
  if (signer.type !== "Key") {
    throw new Error("Use a Cardano payment key wallet.");
  }
  const policy = scriptFromNative({ type: "sig", keyHash: signer.hash });
  const policyId = mintingPolicyToId(policy);
  const tokens = PREVIEW_SYMBOLS.map((symbol) => ({
    symbol,
    unit: toUnit(policyId, new TextEncoder().encode(symbol).toHex()),
  }));
  const minted = Object.fromEntries(tokens.map(({ unit }) => [unit, amount]));
  const lucid = await Lucid(provider, "Preview");
  lucid.selectWallet.fromAddress(address, confirmed);
  const tx = await lucid.newTx()
    .mintAssets(minted)
    .attach.MintingPolicy(policy)
    .addSignerKey(signer.hash)
    .pay.ToAddress(address, minted)
    .complete();
  return { unsigned: tx.toCBOR(), tokens, address };
}

function assemblePreview(body: Record<string, unknown>) {
  const unsigned = CML.Transaction.from_cbor_hex(
    checkedCbor(body.unsigned, 100_000),
  );
  const witness = CML.TransactionWitnessSet.from_cbor_hex(
    checkedCbor(body.witness, 100_000),
  );
  const builder = CML.TransactionWitnessSetBuilder.new();
  builder.add_existing(unsigned.witness_set());
  builder.add_existing(witness);
  return {
    signed: CML.Transaction.new(
      unsigned.body(),
      builder.build(),
      true,
      unsigned.auxiliary_data(),
    ).to_cbor_hex(),
    hash: CML.hash_transaction(unsigned.body()).to_hex(),
  };
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/mint.js", ["mint.js", "text/javascript; charset=utf-8"]],
  ["/mint.css", ["mint.css", "text/css; charset=utf-8"]],
]);
let bytecode: Promise<string> | undefined;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });

export async function handleMintRequest(request: Request): Promise<Response> {
  if (request.headers.get("host") !== host) {
    return json({ error: "Use " + origin }, 403);
  }
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET") {
      if (path === "/api/assets") {
        return json({
          sepolia: SEPOLIA_SYMBOLS,
          preview: PREVIEW_SYMBOLS,
          decimals: DECIMALS,
        });
      }
      const file = staticFiles.get(path);
      if (file) {
        return new Response(
          await Deno.readTextFile(new URL(file[0], import.meta.url)),
          {
            headers: { ...headers, "content-type": file[1] },
          },
        );
      }
    }
    if (request.method === "POST") {
      if (
        request.headers.get("origin") !== origin ||
        request.headers.get("content-type") !== "application/json"
      ) {
        return json({ error: "Use the local mint page." }, 403);
      }
      if (path === "/api/bytecode") {
        bytecode ??= compileContract().catch((error) => {
          bytecode = undefined;
          throw error;
        });
        return json({ bytecode: await bytecode });
      }
      if (path === "/api/preview/build") {
        return json(await buildPreview(await request.json()));
      }
      if (path === "/api/preview/assemble") {
        return json(assemblePreview(await request.json()));
      }
      if (path === "/api/preview/status") {
        const { hash } = await request.json();
        return json({ confirmed: await previewConfirmed(hash) });
      }
    }
    return json({ error: "Page unavailable." }, 404);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Mint preparation failed.";
    return json({
      error: /blockfrost|project_id/i.test(message) &&
          !message.startsWith("Start the local server")
        ? "Preview Blockfrost request failed. Check the project ID and wallet network."
        : message,
    }, 400);
  }
}

if (import.meta.main) {
  Deno.serve({ hostname: "127.0.0.1", port: 8790 }, handleMintRequest);
}
