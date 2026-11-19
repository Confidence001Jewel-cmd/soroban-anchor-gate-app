[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / inspectEscrowTTL

# Function: inspectEscrowTTL()

> **inspectEscrowTTL**(`escrowId`, `options`): `Promise`\<[`TTLInfo`](../interfaces/TTLInfo.md)\>

Defined in: [ttl.ts:91](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L91)

Inspects an escrow's persistent ledger entry and estimates its remaining
time-to-live.

## Parameters

### escrowId

`bigint`

Identifier of the escrow to inspect.

### options

[`TTLInspectorOptions`](../interfaces/TTLInspectorOptions.md)

Contract configuration, optional threshold, and optional
  injectable RPC server.

## Returns

`Promise`\<[`TTLInfo`](../interfaces/TTLInfo.md)\>

Remaining ledgers and days plus a bump recommendation.

## Throws

If the escrow ID is negative, configuration is invalid, the
  threshold is not a non-negative integer, or the entry is missing or
  already expired.
