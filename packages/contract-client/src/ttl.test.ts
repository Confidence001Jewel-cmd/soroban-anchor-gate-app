import assert from "node:assert";
import { test, describe } from "node:test";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import { inspectEscrowTTL, buildEscrowLedgerKey, LEDGERS_PER_DAY } from "./ttl";

const contractId = "CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT";
const config = {
  contractId,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};
const mockServer = (entries: unknown[], latestLedger: number) => ({
  getLedgerEntries: async () => ({ entries, latestLedger }),
}) as never;

describe("inspectEscrowTTL", () => {
  test("returns remaining ledgers and days without bump", async () => {
    const info = await inspectEscrowTTL(1n, {
      config,
      server: mockServer([{ liveUntilLedgerSeq: 1000 + 2 * LEDGERS_PER_DAY + 100_000 }], 1000),
    });
    assert.strictEqual(info.remainingLedgers, 2 * LEDGERS_PER_DAY + 100_000);
    assert.ok(Math.abs(info.remainingDays - (2 + 100_000 / LEDGERS_PER_DAY)) < 1e-9);
    assert.strictEqual(info.needsBump, false);
  });

  test("recommends bump at the threshold boundary", async () => {
    const info = await inspectEscrowTTL(1n, {
      config,
      server: mockServer([{ liveUntilLedgerSeq: 100_500 }], 500),
    });
    assert.strictEqual(info.remainingLedgers, 100_000);
    assert.strictEqual(info.needsBump, true);
    assert.match(info.recommendation, /Bump recommended/);
  });

  test("honours a custom threshold and clamps expired to zero", async () => {
    const info = await inspectEscrowTTL(2n, {
      config,
      bumpThresholdLedgers: 10,
      server: mockServer([{ liveUntilLedgerSeq: 90 }], 100),
    });
    assert.strictEqual(info.remainingLedgers, 0);
    assert.strictEqual(info.needsBump, true);
  });

  test("throws when the entry is missing", async () => {
    await assert.rejects(
      inspectEscrowTTL(3n, { config, server: mockServer([], 10) }),
      /not found or already expired/
    );
  });

  test("rejects negative ids, bad threshold and bad config", async () => {
    const server = mockServer([], 1);
    await assert.rejects(inspectEscrowTTL(-1n, { config, server }), /negative/);
    await assert.rejects(
      inspectEscrowTTL(1n, { config, server, bumpThresholdLedgers: -1 }),
      /non-negative/
    );
    await assert.rejects(
      inspectEscrowTTL(1n, { config: { ...config, contractId: Keypair.random().publicKey() }, server })
    );
  });

  test("builds a persistent contract-data key", () => {
    const key = buildEscrowLedgerKey(contractId, 7n);
    assert.strictEqual(key.type, "contractData");
    assert.strictEqual(
      (key as any).contractData.durability.name,
      xdr.ContractDataDurability.persistent.name
    );
  });
});
