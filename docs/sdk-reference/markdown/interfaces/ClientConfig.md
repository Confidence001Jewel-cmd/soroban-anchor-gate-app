[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / ClientConfig

# Interface: ClientConfig

Defined in: [index.ts:28](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L28)

Connection and network settings required by [EscrowGateClient](../classes/EscrowGateClient.md).

## Properties

### contractId

> **contractId**: `string`

Defined in: [index.ts:30](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L30)

Soroban contract ID encoded as a Stellar `C...` contract address.

***

### networkPassphrase

> **networkPassphrase**: `string`

Defined in: [index.ts:34](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L34)

Stellar network passphrase, for example `Test SDF Network ; September 2015`.

***

### rpcUrl

> **rpcUrl**: `string`

Defined in: [index.ts:32](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L32)

Soroban RPC endpoint used to simulate and submit transactions.
