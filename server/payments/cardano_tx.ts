import * as LucidNs from "@lucid-evolution/lucid";
import {
  Blockfrost,
  CML,
  Lucid,
  type UTxO,
} from "@lucid-evolution/lucid";

const coreToUtxo = (LucidNs as unknown as {
  coreToUtxo: (value: CML.TransactionUnspentOutput) => UTxO;
}).coreToUtxo;
import type { StoredOrder } from "./orders.ts";

export const PREVIEW_BLOCKFROST_URL = "https://cardano-preview.blockfrost.io/api/v0";
const MESSAGE_BYTES = 64;

type ChainProvider = {
  getProtocolParameters: () => Promise<unknown>;
};

export function cardanoPayError(order: StoredOrder, now: number): string | null {
  if (order.domain !== "test.pqpost.com") {
    return "Names shorter than 9 characters are not available for registration yet.";
  }
  if (order.network !== "cardano-preview" || order.asset !== "ADA" || order.assetUnit !== "lovelace") {
    return "Wallet payment is only available for preview ADA.";
  }
  if (order.status !== "quoted") return "This order is no longer waiting for payment.";
  if (order.expiresAt <= now) return "The quote expired.";
  if (!order.recipient.startsWith("addr_test1")) return "The receiving address is not a testnet address.";
  if (!/^[0-9]+$/.test(order.amountAtomic) || BigInt(order.amountAtomic) <= 0n) {
    return "The quoted amount is not payable.";
  }
  if (new TextEncoder().encode(order.message).length > MESSAGE_BYTES) {
    return "The payment message is too long.";
  }
  return null;
}

export function cardanoMetadata(message: string): { "674": { msg: [string] } } {
  return { "674": { msg: [message] } };
}

export function bech32Address(value: string): string {
  if (value.startsWith("addr_test1") || value.startsWith("addr1")) {
    CML.Address.from_bech32(value);
    return value;
  }
  return CML.Address.from_hex(value).to_bech32();
}

export function utxoFromCip30(hex: string): UTxO {
  return coreToUtxo(CML.TransactionUnspentOutput.from_cbor_hex(hex));
}

/** Select a bounded funded subset; input order must not hide a large UTxO. */
export function selectWalletUtxos(utxos: UTxO[]): UTxO[] {
  return [...utxos].sort((a,b) => {
    const first = a.assets.lovelace ?? 0n, second = b.assets.lovelace ?? 0n;
    return first > second ? -1 : first < second ? 1 : 0;
  }).slice(0,40);
}

export async function buildPreviewUnsigned(
  order: StoredOrder,
  input: { changeAddress: string; utxos: UTxO[] },
  provider: ChainProvider,
  now = Date.now(),
): Promise<string> {
  const error = cardanoPayError(order, now);
  if (error) throw new Error(error);
  if (!input.changeAddress.startsWith("addr_test1")) {
    throw new Error("The Cardano wallet must be on a test network.");
  }
  if (!input.utxos.length) throw new Error("The Cardano wallet has no funds.");
  const lucid = await Lucid(provider as never, "Preview");
  lucid.selectWallet.fromAddress(input.changeAddress, input.utxos);
  const tx = await lucid
    .newTx()
    .pay.ToAddress(order.recipient, { lovelace: BigInt(order.amountAtomic) })
    .attachMetadata(674, cardanoMetadata(order.message)["674"])
    .complete();
  const unsigned = tx.toCBOR();
  assertMatchesOrder(unsigned, order);
  return unsigned;
}

export function assembleSignedTransaction(
  unsignedTx: string,
  witnessSet: string,
  order: StoredOrder,
): string {
  assertMatchesOrder(unsignedTx, order);
  const unsigned = CML.Transaction.from_cbor_hex(unsignedTx);
  const witness = CML.TransactionWitnessSet.from_cbor_hex(witnessSet);
  const builder = CML.TransactionWitnessSetBuilder.new();
  builder.add_existing(unsigned.witness_set());
  builder.add_existing(witness);
  const signed = CML.Transaction.new(
    unsigned.body(),
    builder.build(),
    true,
    unsigned.auxiliary_data(),
  );
  const hex = signed.to_cbor_hex();
  assertMatchesOrder(hex, order);
  return hex;
}

export function previewBlockfrost(projectId: string): ChainProvider {
  return new Blockfrost(PREVIEW_BLOCKFROST_URL, projectId);
}

type MetadataField = {
  k?: { string?: string };
  v?: { list?: Array<{ string?: string }> };
};

function assertMatchesOrder(txHex: string, order: StoredOrder): void {
  const body = JSON.parse(CML.Transaction.from_cbor_hex(txHex).to_json()) as {
    body?: { outputs?: Array<Record<string, unknown>> };
    auxiliary_data?: {
      Shelley?: {
        entries?: Array<[unknown, { map?: MetadataField[] }]>;
      };
    };
  };
  const entries = body.auxiliary_data?.Shelley?.entries ?? [];
  const labels = entries.filter((entry) => String(entry[0]) === "674");
  const lines = labels.length === 1
    ? (labels[0][1].map ?? []).find((field) => field.k?.string === "msg")?.v?.list ?? []
    : [];
  if (labels.length !== 1 || lines.length !== 1 || lines[0]?.string !== order.message) {
    throw new Error("The transaction payment message does not match the order.");
  }
  let paid = 0n;
  for (const output of body.body?.outputs ?? []) {
    const formatted = (output.AlonzoFormatTxOut ?? output.ConwayFormatTxOut ?? output) as {
      address?: string;
      amount?: { coin?: number | string };
    };
    if (formatted.address !== order.recipient || formatted.amount?.coin === undefined) continue;
    paid += BigInt(formatted.amount.coin);
  }
  if (paid < BigInt(order.amountAtomic)) {
    throw new Error("The transaction does not pay the quoted amount.");
  }
}
