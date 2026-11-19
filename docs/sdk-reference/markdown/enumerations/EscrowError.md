[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / EscrowError

# Enumeration: EscrowError

Defined in: [index.ts:88](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L88)

Numeric error codes emitted by the escrow contract.

The values match the contract's `Error` enum and can be compared against
diagnostic events or simulation failures.

## Enumeration Members

### AlreadyInitialized

> **AlreadyInitialized**: `2`

Defined in: [index.ts:92](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L92)

The contract was already initialized.

***

### ArithmeticOverflow

> **ArithmeticOverflow**: `10`

Defined in: [index.ts:108](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L108)

An arithmetic operation overflowed.

***

### EscrowNotFound

> **EscrowNotFound**: `4`

Defined in: [index.ts:96](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L96)

No escrow exists for the supplied identifier.

***

### InvalidBps

> **InvalidBps**: `9`

Defined in: [index.ts:106](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L106)

Basis points are invalid or do not sum to 10,000.

***

### InvalidDisputeSplit

> **InvalidDisputeSplit**: `12`

Defined in: [index.ts:112](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L112)

The dispute split is invalid.

***

### InvalidStatus

> **InvalidStatus**: `5`

Defined in: [index.ts:98](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L98)

The escrow is not in a state that permits the operation.

***

### NotInitialized

> **NotInitialized**: `1`

Defined in: [index.ts:90](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L90)

The contract has not been initialized.

***

### TokenNotWhitelisted

> **TokenNotWhitelisted**: `11`

Defined in: [index.ts:110](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L110)

The token is not on the contract whitelist.

***

### Unauthorized

> **Unauthorized**: `3`

Defined in: [index.ts:94](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L94)

The caller is not authorized for the requested operation.

***

### UnlockTimeNotReached

> **UnlockTimeNotReached**: `6`

Defined in: [index.ts:100](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L100)

The unlock timestamp has not been reached yet.

***

### UnlockTimePassed

> **UnlockTimePassed**: `7`

Defined in: [index.ts:102](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L102)

The unlock timestamp has already passed.

***

### ZeroAmount

> **ZeroAmount**: `8`

Defined in: [index.ts:104](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L104)

The supplied amount is zero.
