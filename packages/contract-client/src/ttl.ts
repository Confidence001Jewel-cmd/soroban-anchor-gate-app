import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { ClientConfig, validateClientConfig } from "./index";

/** Approximate Stellar ledger close time in seconds. */
export const SECONDS_PER_LEDGER = 5;
export const LEDGERS_PER_DAY = 17_280;
/** Matches PERSISTENT_EXTEND_TTL_THRESHOLD in the escrow contract. */
export const DEFAULT_BUMP_THRESHOLD_LEDGERS = 100_000;

export interface TTLInfo {
  escrowId: bigint;
  /** Ledger sequence at which the entry expires (inclusive of liveUntilLedgerSeq). */
  liveUntilLedger: number;
  currentLedger: number;
  remainingLedgers: number;
  remainingDays: number;
  /** True when remainingLedgers is at or below the bump threshold. */
  needsBump: boolean;
  recommendation: string;
}

export interface TTLInspectorOptions {
  config: ClientConfig;
  /** Ledgers remaining at or below which a bump is recommended. */
  bumpThresholdLedgers?: number;
  /** Injectable RPC server (defaults to a server built from config.rpcUrl). */
  server?: Pick<rpc.Server, "getLedgerEntries">;
}

/** Builds the persistent `DataKey::Escrow(id)` ledger key for the contract. */
export function buildEscrowLedgerKey(contractId: string, escrowId: bigint): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Escrow"),
        nativeToScVal(escrowId, { type: "u64" }),
      ]),
      durability: xdr.ContractDataDurability.persistent,
    })
  );
}

export async function inspectEscrowTTL(
  escrowId: bigint,
  options: TTLInspectorOptions
): Promise<TTLInfo> {
  if (escrowId < 0n) {
    throw new Error("escrowId cannot be negative");
  }
  validateClientConfig(options.config);
  const threshold = options.bumpThresholdLedgers ?? DEFAULT_BUMP_THRESHOLD_LEDGERS;
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error("bumpThresholdLedgers must be a non-negative integer");
  }

  const server =
    options.server ??
    new rpc.Server(options.config.rpcUrl, {
      allowHttp: options.config.rpcUrl.startsWith("http://"),
    });
  const key = buildEscrowLedgerKey(options.config.contractId, escrowId);
  const res = await server.getLedgerEntries(key);
  const entry = res.entries?.[0];
  if (!entry || entry.liveUntilLedgerSeq === undefined) {
    throw new Error(`Escrow ${escrowId} not found or already expired`);
  }

  const remainingLedgers = Math.max(0, entry.liveUntilLedgerSeq - res.latestLedger);
  const remainingDays = (remainingLedgers * SECONDS_PER_LEDGER) / 86_400;
  const needsBump = remainingLedgers <= threshold;
  return {
    escrowId,
    liveUntilLedger: entry.liveUntilLedgerSeq,
    currentLedger: res.latestLedger,
    remainingLedgers,
    remainingDays,
    needsBump,
    recommendation: needsBump
      ? `Bump recommended: only ${remainingLedgers} ledgers (~${remainingDays.toFixed(1)} days) remain`
      : "No bump required",
  };
}
