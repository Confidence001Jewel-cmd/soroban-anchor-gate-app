/**
 * Helpers for inspecting and reasoning about Soroban persistent entry TTLs.
 *
 * Escrow records are stored as persistent contract data. If their time-to-live
 * is not extended before it reaches zero, the entry can be archived and the
 * escrow becomes temporarily unavailable. These helpers let clients warn
 * operators before that happens.
 *
 * @packageDocumentation
 */

import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { ClientConfig, validateClientConfig } from "./index";

/** Approximate Stellar ledger close time in seconds. */
export const SECONDS_PER_LEDGER = 5;

/** Number of ledgers expected to close in one 24-hour period. */
export const LEDGERS_PER_DAY = 17_280;

/** Matches PERSISTENT_EXTEND_TTL_THRESHOLD in the escrow contract. */
export const DEFAULT_BUMP_THRESHOLD_LEDGERS = 100_000;

/**
 * Result of inspecting an escrow entry's remaining time-to-live.
 */
export interface TTLInfo {
  /** Identifier of the escrow that was inspected. */
  escrowId: bigint;
  /** Ledger sequence at which the entry expires (inclusive of liveUntilLedgerSeq). */
  liveUntilLedger: number;
  /** Latest ledger sequence reported by the RPC server. */
  currentLedger: number;
  /** Number of ledgers remaining before expiry, clamped to zero. */
  remainingLedgers: number;
  /** Estimated number of days remaining before expiry. */
  remainingDays: number;
  /** True when remainingLedgers is at or below the bump threshold. */
  needsBump: boolean;
  /** Human-readable recommendation suitable for logs or operator alerts. */
  recommendation: string;
}

/**
 * Options for {@link inspectEscrowTTL}.
 */
export interface TTLInspectorOptions {
  /** Contract and RPC settings used to create the default RPC server. */
  config: ClientConfig;
  /** Ledgers remaining at or below which a bump is recommended. */
  bumpThresholdLedgers?: number;
  /** Injectable RPC server (defaults to a server built from config.rpcUrl). */
  server?: Pick<rpc.Server, "getLedgerEntries">;
}

/**
 * Builds the persistent `DataKey::Escrow(id)` ledger key for the contract.
 *
 * @param contractId - Soroban contract ID holding the escrow entries.
 * @param escrowId - Identifier of the escrow to look up.
 * @returns Ledger key for the persistent contract-data entry.
 */
export function buildEscrowLedgerKey(
  contractId: string,
  escrowId: bigint
): xdr.LedgerKey {
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

/**
 * Inspects an escrow's persistent ledger entry and estimates its remaining
 * time-to-live.
 *
 * @param escrowId - Identifier of the escrow to inspect.
 * @param options - Contract configuration, optional threshold, and optional
 *   injectable RPC server.
 * @returns Remaining ledgers and days plus a bump recommendation.
 * @throws {Error} If the escrow ID is negative, configuration is invalid, the
 *   threshold is not a non-negative integer, or the entry is missing or
 *   already expired.
 */
export async function inspectEscrowTTL(
  escrowId: bigint,
  options: TTLInspectorOptions
): Promise<TTLInfo> {
  if (escrowId < 0n) {
    throw new Error("escrowId cannot be negative");
  }
  validateClientConfig(options.config);
  const threshold =
    options.bumpThresholdLedgers ?? DEFAULT_BUMP_THRESHOLD_LEDGERS;
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

  const remainingLedgers = Math.max(
    0,
    entry.liveUntilLedgerSeq - res.latestLedger
  );
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
      ? `Bump recommended: only ${remainingLedgers} ledgers (~${remainingDays.toFixed(
          1
        )} days) remain`
      : "No bump required",
  };
}
