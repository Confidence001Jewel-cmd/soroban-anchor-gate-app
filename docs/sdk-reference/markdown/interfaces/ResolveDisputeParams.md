[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / ResolveDisputeParams

# Interface: ResolveDisputeParams

Defined in: [index.ts:118](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L118)

Arguments for resolving a disputed escrow through `resolve_dispute`.

## Properties

### beneficiaryBps

> **beneficiaryBps**: `number`

Defined in: [index.ts:126](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L126)

Share awarded to the beneficiary, in basis points out of 10,000.

***

### caller

> **caller**: `string`

Defined in: [index.ts:122](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L122)

Stellar account authorized to resolve the dispute.

***

### escrowId

> **escrowId**: `bigint`

Defined in: [index.ts:120](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L120)

Identifier of the escrow to resolve.

***

### payerBps

> **payerBps**: `number`

Defined in: [index.ts:124](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L124)

Share awarded to the payer, in basis points out of 10,000.
