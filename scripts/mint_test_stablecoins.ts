import type { ConfiguredAsset } from "../server/payments/config.ts";

import {
  atomicAmount,
  DECIMALS,
  ETH_ADDRESS,
  PREVIEW_SYMBOLS,
  SEPOLIA_SYMBOLS,
} from "./testnet-mint/assets.ts";

const USAGE =
  "Usage: mint_test_stablecoins.ts <ethereum-sepolia> <tUSDC|tUSDT> <whole-token amount>\n" +
  "       mint_test_stablecoins.ts <cardano-preview> <whole-token amount per coin>";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

function ethereumAddress(name: string): string {
  const address = requiredEnv(name);
  if (!ETH_ADDRESS.test(address) || /^0x0{40}$/i.test(address)) {
    throw new Error(`Set ${name} to a nonzero Ethereum address.`);
  }
  return address;
}

async function mintSepolia(
  symbol: string,
  supply: bigint,
): Promise<ConfiguredAsset[]> {
  const rpc = requiredEnv("MAIL_TEST_PAYMENT_ETH_RPC_URL");
  const account = requiredEnv("SEPOLIA_MINT_ACCOUNT");
  const destination = ethereumAddress("SEPOLIA_MINT_TO");
  const recipient = ethereumAddress("SEPOLIA_PAYMENT_RECIPIENT");
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
  });
  if (!response.ok || (await response.json()).result !== "0xaa36a7") {
    throw new Error("Ethereum RPC must report Sepolia chain ID 11155111.");
  }

  const buildDir = await Deno.makeTempDir({ prefix: "pqpost-test-token-" });
  try {
    const result = await new Deno.Command("forge", {
      args: [
        "create",
        "scripts/contracts/TestStablecoin.sol:TestStablecoin",
        "--use",
        "0.8.24",
        "--out",
        `${buildDir}/out`,
        "--cache-path",
        `${buildDir}/cache`,
        "--rpc-url",
        rpc,
        "--chain",
        "11155111",
        "--account",
        account,
        "--broadcast",
        "--json",
        "--constructor-args",
        symbol,
        destination,
        supply.toString(),
      ],
      stdin: "inherit",
      stderr: "inherit",
      stdout: "piped",
    }).output();
    if (!result.success) {
      throw new Error(
        "Deployment failed. Check the Sepolia signer history before retrying.",
      );
    }
    const deployed = JSON.parse(new TextDecoder().decode(result.stdout));
    if (
      typeof deployed.deployedTo !== "string" ||
      !ETH_ADDRESS.test(deployed.deployedTo)
    ) {
      throw new Error(
        "Missing contract address. Check the Sepolia signer history before retrying.",
      );
    }
    console.error(`Sepolia ${symbol} deployment: ${deployed.transactionHash}`);
    return [{
      network: "ethereum-sepolia",
      symbol,
      unit: deployed.deployedTo,
      recipient,
      decimals: DECIMALS,
    }];
  } finally {
    await Deno.remove(buildDir, { recursive: true });
  }
}

async function mintPreview(supply: bigint): Promise<ConfiguredAsset[]> {
  const {
    Blockfrost,
    CML,
    Lucid,
    mintingPolicyToId,
    paymentCredentialOf,
    scriptFromNative,
    toUnit,
  } = await import("@lucid-evolution/lucid");
  const { PREVIEW_BLOCKFROST_URL } = await import(
    "../server/payments/cardano_tx.ts"
  );
  const projectId = requiredEnv("MAIL_TEST_PAYMENT_BLOCKFROST_KEY");
  if (!projectId.startsWith("preview")) {
    throw new Error("Use a Cardano Preview Blockfrost project ID.");
  }
  function previewAddress(name: string): string {
    const address = requiredEnv(name);
    if (
      !address.startsWith("addr_test1") ||
      CML.Address.from_bech32(address).network_id() !== 0
    ) {
      throw new Error(`Set ${name} to a Cardano Preview payment address.`);
    }
    return address;
  }
  const destination = previewAddress("PREVIEW_MINT_TO");
  const recipient = previewAddress("PREVIEW_PAYMENT_RECIPIENT");
  const lucid = await Lucid(
    new Blockfrost(PREVIEW_BLOCKFROST_URL, projectId),
    "Preview",
  );
  lucid.selectWallet.fromPrivateKey(
    (await Deno.readTextFile(requiredEnv("PREVIEW_MINT_KEY_FILE"))).trim(),
  );
  const signer = paymentCredentialOf(await lucid.wallet().address());
  const policy = scriptFromNative({ type: "sig", keyHash: signer.hash });
  const policyId = mintingPolicyToId(policy);
  const assets: ConfiguredAsset[] = PREVIEW_SYMBOLS.map((symbol) => ({
    network: "cardano-preview",
    symbol,
    unit: toUnit(policyId, new TextEncoder().encode(symbol).toHex()),
    recipient,
    decimals: DECIMALS,
  }));
  const minted = Object.fromEntries(assets.map(({ unit }) => [unit, supply]));
  const tx = await lucid.newTx()
    .mintAssets(minted)
    .attach.MintingPolicy(policy)
    .pay.ToAddress(destination, minted)
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const expectedHash = signed.toHash();
  console.error(`Cardano Preview mint transaction: ${expectedHash}`);
  await signed.submit();
  return assets;
}

if (import.meta.main) {
  const [network, arg, amount] = Deno.args;
  try {
    if (
      Deno.args.length === 3 && network === "ethereum-sepolia" &&
      SEPOLIA_SYMBOLS.includes(arg)
    ) {
      console.log(JSON.stringify(await mintSepolia(arg, atomicAmount(amount))));
    } else if (Deno.args.length === 2 && network === "cardano-preview") {
      console.log(JSON.stringify(await mintPreview(atomicAmount(arg))));
    } else {
      throw new Error(USAGE);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
