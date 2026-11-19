[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / buildEscrowLedgerKey

# Function: buildEscrowLedgerKey()

> **buildEscrowLedgerKey**(`contractId`, `escrowId`): `LedgerKey`

Defined in: [ttl.ts:63](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L63)

Builds the persistent `DataKey::Escrow(id)` ledger key for the contract.

## Parameters

### contractId

`string`

Soroban contract ID holding the escrow entries.

### escrowId

`bigint`

Identifier of the escrow to look up.

## Returns

`LedgerKey`

Ledger key for the persistent contract-data entry.
