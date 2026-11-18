import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CML,
  PROTOCOL_PARAMETERS_DEFAULT,
  generateEmulatorAccount,
} from "@lucid-evolution/lucid";
import {
  assembleSignedTransaction,
  buildPreviewUnsigned,
  cardanoPayError,
  selectWalletUtxos,
} from "./cardano_tx.ts";
import type { StoredOrder } from "./orders.ts";

function order(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    orderId: "b34af21f-ccfd-404b-84cc-865afdad3100",
    username: "abc",
    domain: "test.pqpost.com",
    fingerprint: "fp",
    proofNonce: 1,
    asset: "ADA",
    network: "cardano-preview",
    recipient: "",
    assetUnit: "lovelace",
    usdCents: 100,
    amountAtomic: "2000000",
    decimals: 6,
    usdPerToken: "0.16",
    confirmations: 2,
    message: "pqpost:11111111-1111-4111-8111-111111111111",
    createdAt: 1,
    expiresAt: Date.now() + 60_000,
    graceUntil: Date.now() + 120_000,
    status: "quoted",
    transactionId: null,
    active: true,
    ...overrides,
  };
}

Deno.test("preview ADA builder refuses other orders before asking for protocol parameters", async () => {
  let calls = 0;
  const provider = {
    getProtocolParameters: () => {
      calls += 1;
      return Promise.resolve(PROTOCOL_PARAMETERS_DEFAULT);
    },
  };
  const buyer = generateEmulatorAccount({ lovelace: 20_000_000n });
  const quoted = order({ recipient: buyer.address });
  assertEquals(cardanoPayError({ ...quoted, domain: "pqpost.com" }, Date.now())?.includes("not available"), true);
  await assertRejects(() =>
    buildPreviewUnsigned(
      { ...quoted, network: "cardano-mainnet" },
      { changeAddress: buyer.address, utxos: [] },
      provider,
    )
  );
  await assertRejects(() =>
    buildPreviewUnsigned(
      { ...quoted, assetUnit: "deadbeef" },
      { changeAddress: buyer.address, utxos: [] },
      provider,
    )
  );
  assertEquals(calls, 0);

  const unsigned = await buildPreviewUnsigned(quoted, {
    changeAddress: buyer.address,
    utxos: [{
      txHash: "11".repeat(32),
      outputIndex: 0,
      address: buyer.address,
      assets: { lovelace: 20_000_000n },
    }],
  }, provider);
  assertEquals(calls, 1);
  const body = JSON.parse(CML.Transaction.from_cbor_hex(unsigned).to_json());
  const labels = body.auxiliary_data.Shelley.entries.filter((entry: [unknown]) =>
    String(entry[0]) === "674"
  );
  assertEquals(labels.length, 1);
  const line = labels[0][1].map.find((field: { k?: { string?: string } }) =>
    field.k?.string === "msg"
  ).v.list;
  assertEquals(line, [{ string: quoted.message }]);
  const signed = assembleSignedTransaction(
    unsigned,
    CML.TransactionWitnessSet.new().to_cbor_hex(),
    quoted,
  );
  const signedBody = JSON.parse(CML.Transaction.from_cbor_hex(signed).to_json());
  const signedLine = signedBody.auxiliary_data.Shelley.entries
    .find((entry: [unknown]) => String(entry[0]) === "674")[1].map
    .find((field: { k?: { string?: string } }) => field.k?.string === "msg").v.list;
  assertEquals(signedLine, [{ string: quoted.message }]);
});

Deno.test("fragmented wallets select a funded bounded subset even when the large UTxO is last", async () => {
  const buyer = generateEmulatorAccount({lovelace:100000000n});
  const utxos = Array.from({length:41}, (_,index) => ({txHash:index.toString(16).padStart(64,"0"),outputIndex:0,address:buyer.address,assets:{lovelace:index===40 ? 20000000n : 1000000n}}));
  const selected = selectWalletUtxos(utxos);
  assertEquals(selected.length,40);
  assertEquals(selected[0].assets.lovelace,20000000n);
  const unsigned = await buildPreviewUnsigned(order({recipient:buyer.address}), {changeAddress:buyer.address,utxos:selected}, {getProtocolParameters:() => Promise.resolve(PROTOCOL_PARAMETERS_DEFAULT)});
  assertEquals(CML.Transaction.from_cbor_hex(unsigned).body().outputs().len() > 0,true);
});

Deno.test("Preview token checkout verifies the quoted unit and atomic amount", async () => {
  const unit = "ab".repeat(28) + "745553444d";
  const buyer = generateEmulatorAccount({ lovelace: 20_000_000n });
  const merchant = generateEmulatorAccount({ lovelace: 20_000_000n });
  const quote = order({
    asset: "tUSDM",
    assetUnit: unit,
    recipient: merchant.address,
  });
  const unsigned = await buildPreviewUnsigned(quote, {
    changeAddress: buyer.address,
    utxos: [{
      txHash: "11".repeat(32),
      outputIndex: 0,
      address: buyer.address,
      assets: { lovelace: 20_000_000n, [unit]: 3_000_000n },
    }],
  }, { getProtocolParameters: () => Promise.resolve(PROTOCOL_PARAMETERS_DEFAULT) });
  const witness = CML.TransactionWitnessSet.new().to_cbor_hex();
  assembleSignedTransaction(unsigned, witness, quote);
  assertThrows(() =>
    assembleSignedTransaction(unsigned, witness, { ...quote, assetUnit: "cd".repeat(28) })
  );
  assertThrows(() =>
    assembleSignedTransaction(unsigned, witness, { ...quote, amountAtomic: "2000001" })
  );
});
