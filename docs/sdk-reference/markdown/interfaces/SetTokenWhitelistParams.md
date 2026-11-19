[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / SetTokenWhitelistParams

# Interface: SetTokenWhitelistParams

Defined in: [index.ts:132](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L132)

Arguments for updating the token whitelist through `set_token_whitelist`.

## Properties

### caller

> **caller**: `string`

Defined in: [index.ts:134](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L134)

Stellar account authorized to update the whitelist.

***

### token

> **token**: `string`

Defined in: [index.ts:136](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L136)

Token contract address to update.

***

### whitelisted

> **whitelisted**: `boolean`

Defined in: [index.ts:138](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L138)

Whether the token should be allowed for escrow creation.
