[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / EscrowCreateParams

# Interface: EscrowCreateParams

Defined in: [index.ts:40](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L40)

Arguments for creating a new escrow through `create_escrow`.

## Properties

### amount

> **amount**: `bigint`

Defined in: [index.ts:48](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L48)

Amount in the token's smallest unit (stroops for seven-decimal tokens).

***

### beneficiary

> **beneficiary**: `string`

Defined in: [index.ts:44](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L44)

Stellar account that can receive the escrowed funds.

***

### lockDurationSeconds

> **lockDurationSeconds**: `bigint`

Defined in: [index.ts:52](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L52)

Number of seconds the funds remain locked before refunds are allowed.

***

### payer

> **payer**: `string`

Defined in: [index.ts:42](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L42)

Stellar account funding and owning the escrow.

***

### profileHashHex

> **profileHashHex**: `string`

Defined in: [index.ts:50](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L50)

SHA-256 hash of the beneficiary routing profile, as 64 hexadecimal characters.

***

### token

> **token**: `string`

Defined in: [index.ts:46](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L46)

Token contract address used for the escrow amount.
