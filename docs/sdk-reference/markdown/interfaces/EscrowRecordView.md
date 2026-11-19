[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / EscrowRecordView

# Interface: EscrowRecordView

Defined in: [index.ts:144](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L144)

Decoded view of an escrow record returned by `get_escrow`.

## Properties

### amount

> **amount**: `bigint`

Defined in: [index.ts:152](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L152)

Escrowed amount in the token's smallest unit.

***

### beneficiary

> **beneficiary**: `string`

Defined in: [index.ts:148](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L148)

Stellar account that can receive the escrowed funds.

***

### payer

> **payer**: `string`

Defined in: [index.ts:146](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L146)

Stellar account that funded the escrow.

***

### profileHashHex

> **profileHashHex**: `string`

Defined in: [index.ts:154](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L154)

SHA-256 hash of the beneficiary routing profile, as hexadecimal.

***

### status

> **status**: [`EscrowContractState`](../enumerations/EscrowContractState.md)

Defined in: [index.ts:156](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L156)

Current lifecycle state of the escrow.

***

### token

> **token**: `string`

Defined in: [index.ts:150](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L150)

Token contract address used for the escrow amount.

***

### unlockTimestamp

> **unlockTimestamp**: `bigint`

Defined in: [index.ts:158](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L158)

Unix timestamp, in seconds, when the escrow becomes refundable.
