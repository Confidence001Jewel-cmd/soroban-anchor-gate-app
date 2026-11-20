[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / TTLInfo

# Interface: TTLInfo

Defined in: [ttl.ts:27](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L27)

Result of inspecting an escrow entry's remaining time-to-live.

## Properties

### currentLedger

> **currentLedger**: `number`

Defined in: [ttl.ts:33](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L33)

Latest ledger sequence reported by the RPC server.

***

### escrowId

> **escrowId**: `bigint`

Defined in: [ttl.ts:29](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L29)

Identifier of the escrow that was inspected.

***

### liveUntilLedger

> **liveUntilLedger**: `number`

Defined in: [ttl.ts:31](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L31)

Ledger sequence at which the entry expires (inclusive of liveUntilLedgerSeq).

***

### needsBump

> **needsBump**: `boolean`

Defined in: [ttl.ts:39](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L39)

True when remainingLedgers is at or below the bump threshold.

***

### recommendation

> **recommendation**: `string`

Defined in: [ttl.ts:41](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L41)

Human-readable recommendation suitable for logs or operator alerts.

***

### remainingDays

> **remainingDays**: `number`

Defined in: [ttl.ts:37](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L37)

Estimated number of days remaining before expiry.

***

### remainingLedgers

> **remainingLedgers**: `number`

Defined in: [ttl.ts:35](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L35)

Number of ledgers remaining before expiry, clamped to zero.
