[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / computeProfileHash

# Function: computeProfileHash()

> **computeProfileHash**(`routingInfo`): `string`

Defined in: [index.ts:214](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L214)

Computes the SHA-256 hash used to store a beneficiary routing profile
on-chain.

Leading and trailing whitespace is ignored so equivalent profiles produce
the same hash. The returned value is lowercase hexadecimal and is always 64
characters long.

## Parameters

### routingInfo

`string`

Raw routing information, such as an IBAN or bank
  account reference.

## Returns

`string`

Lowercase SHA-256 hash as hexadecimal.

## Throws

If `routingInfo` is empty or contains only whitespace.
