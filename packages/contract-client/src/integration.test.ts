/**
 * Integration tests against a local Soroban sandbox (stellar/quickstart --local).
 *
 * Skipped unless SOROBAN_SANDBOX_RPC_URL is set. Start the sandbox with
 * `docker compose -f docker-compose.sandbox.yml up -d --wait` and build the
 * contract WASM first (`cd contracts && cargo build --target wasm32-unknown-unknown --release`).
 *
 * Environment:
 *   SOROBAN_SANDBOX_RPC_URL   e.g. http://localhost:8000/soroban/rpc
 *   SOROBAN_SANDBOX_FRIENDBOT e.g. http://localhost:8000/friendbot
 *   ESCROW_WASM_PATH          optional, defaults to the release build output
 */
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  Address,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { EscrowContractState, EscrowGateClient } from "./index";
import { inspectEscrowTTL } from "./ttl";

const RPC_URL = process.env.SOROBAN_SANDBOX_RPC_URL;
const FRIENDBOT = process.env.SOROBAN_SANDBOX_FRIENDBOT;
const PASSPHRASE = "Standalone Network ; February 2017";
const WASM_PATH =
  process.env.ESCROW_WASM_PATH ??
  resolve(
    __dirname,
    "../../../contracts/target/wasm32-unknown-unknown/release/soroban_anchor_escrow.wasm"
  );

async function fund(address: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${address}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`friendbot failed: ${res.status}`);
  }
}

async function send(
  server: rpc.Server,
  source: Keypair,
  operation: xdr.Operation
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const acct = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(new Account(acct.accountId(), acct.sequenceNumber()), {
    fee: "1000000",
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return res;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction failed: ${sent.hash}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction timed out: ${sent.hash}`);
}

test(
  "sandbox: escrow lifecycle against a local Soroban node",
  { skip: !RPC_URL || !FRIENDBOT, timeout: 240_000 },
  async () => {
    const server = new rpc.Server(RPC_URL!, { allowHttp: true });
    const admin = Keypair.random();
    const payer = Keypair.random();
    const beneficiary = Keypair.random();
    await Promise.all([admin, payer, beneficiary].map((k) => fund(k.publicKey())));

    // Upload + instantiate the escrow contract.
    const wasm = readFileSync(WASM_PATH);
    await send(server, admin, Operation.uploadContractWasm({ wasm }));
    const wasmHash = (await import("crypto")).createHash("sha256").update(wasm).digest();
    const created = await send(
      server,
      admin,
      Operation.createCustomContract({
        address: new Address(admin.publicKey()),
        wasmHash,
        salt: Buffer.from(Keypair.random().rawPublicKey()),
      })
    );
    const contractId = Address.fromScVal(created.returnValue!).toString();

    // Native asset Stellar Asset Contract as the escrow token (may already exist).
    const nativeAsset = Asset.native();
    try {
      await send(server, admin, Operation.createStellarAssetContract({ asset: nativeAsset }));
    } catch {
      /* already deployed on this sandbox */
    }
    const token = nativeAsset.contractId(PASSPHRASE);

    const client = new EscrowGateClient({
      contractId,
      rpcUrl: RPC_URL!,
      networkPassphrase: PASSPHRASE,
    });

    await send(
      server,
      admin,
      client.buildOperation(
        "init",
        client.buildInitTx(admin.publicKey(), admin.publicKey(), 100)
      )
    );
    await send(
      server,
      admin,
      client.buildOperation(
        "set_token_whitelist",
        client.buildSetTokenWhitelistTx({
          caller: admin.publicKey(),
          token,
          whitelisted: true,
        })
      )
    );

    const created2 = await send(
      server,
      payer,
      client.buildOperation(
        "create_escrow",
        client.buildCreateEscrowTx({
          payer: payer.publicKey(),
          beneficiary: beneficiary.publicKey(),
          token,
          amount: 10_000_000n,
          profileHashHex: "ab".repeat(32),
          lockDurationSeconds: 3600n,
        })
      )
    );
    assert.strictEqual(BigInt(client.decodeContractResult(created2.returnValue!)), 1n);

    // Read the record back through the SDK parser.
    const sim = await server.simulateTransaction(
      new TransactionBuilder(
        new Account(payer.publicKey(), (await server.getAccount(payer.publicKey())).sequenceNumber()),
        { fee: "100", networkPassphrase: PASSPHRASE }
      )
        .addOperation(client.buildOperation("get_escrow", client.buildGetEscrowTx(1n)))
        .setTimeout(60)
        .build()
    );
    assert.ok(rpc.Api.isSimulationSuccess(sim), "get_escrow simulation should succeed");
    const record = client.parseEscrowRecord(sim.result!.retval);
    assert.strictEqual(record.status, EscrowContractState.Funded);
    assert.strictEqual(record.amount, 10_000_000n);
    assert.strictEqual(record.payer, payer.publicKey());

    // TTL inspector against a real ledger entry.
    const ttl = await inspectEscrowTTL(1n, {
      config: { contractId, rpcUrl: RPC_URL!, networkPassphrase: PASSPHRASE },
    });
    assert.ok(ttl.remainingLedgers > 0);
    assert.ok(ttl.liveUntilLedger > ttl.currentLedger);

    // Refund before the lock expires must be rejected by the contract.
    await assert.rejects(
      send(server, payer, client.buildOperation("refund", client.buildRefundTx(1n))),
      /Error\(Contract, #6\)|UnlockTimeNotReached|simulation|failed/i
    );
  }
);
