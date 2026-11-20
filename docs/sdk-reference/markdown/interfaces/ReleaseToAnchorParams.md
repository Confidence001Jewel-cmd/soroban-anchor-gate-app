[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / ReleaseToAnchorParams

# Interface: ReleaseToAnchorParams

Defined in: [index.ts:59](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L59)

Arguments for releasing an escrowed payment to an anchor disbursement
address through `release_to_anchor`.

## Properties

### anchorDisbursementAddress

> **anchorDisbursementAddress**: `string`

Defined in: [index.ts:65](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L65)

Anchor-controlled Stellar account that receives the funds.

***

### caller

> **caller**: `string`

Defined in: [index.ts:63](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L63)

Stellar account authorized to invoke the release.

***

### escrowId

> **escrowId**: `bigint`

Defined in: [index.ts:61](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L61)

Identifier of the escrow to release.
