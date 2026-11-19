[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / EscrowContractState

# Enumeration: EscrowContractState

Defined in: [index.ts:71](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L71)

On-chain escrow lifecycle states returned by `get_escrow`.

## Enumeration Members

### Disbursed

> **Disbursed**: `"Disbursed"`

Defined in: [index.ts:75](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L75)

Funds were released to the anchor.

***

### Disputed

> **Disputed**: `"Disputed"`

Defined in: [index.ts:79](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L79)

The escrow is subject to an active dispute.

***

### Funded

> **Funded**: `"Funded"`

Defined in: [index.ts:73](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L73)

Funds are locked and awaiting release or refund.

***

### Refunded

> **Refunded**: `"Refunded"`

Defined in: [index.ts:77](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L77)

Funds were returned to the payer.
