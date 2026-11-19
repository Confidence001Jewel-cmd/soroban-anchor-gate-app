[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / TTLInspectorOptions

# Interface: TTLInspectorOptions

Defined in: [ttl.ts:47](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L47)

Options for [inspectEscrowTTL](../functions/inspectEscrowTTL.md).

## Properties

### bumpThresholdLedgers?

> `optional` **bumpThresholdLedgers?**: `number`

Defined in: [ttl.ts:51](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L51)

Ledgers remaining at or below which a bump is recommended.

***

### config

> **config**: [`ClientConfig`](ClientConfig.md)

Defined in: [ttl.ts:49](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L49)

Contract and RPC settings used to create the default RPC server.

***

### server?

> `optional` **server?**: `Pick`\<`RpcServer`, `"getLedgerEntries"`\>

Defined in: [ttl.ts:53](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/ttl.ts#L53)

Injectable RPC server (defaults to a server built from config.rpcUrl).
