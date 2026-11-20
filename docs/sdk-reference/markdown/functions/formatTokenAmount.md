[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / formatTokenAmount

# Function: formatTokenAmount()

> **formatTokenAmount**(`amount`, `decimals?`): `string`

Defined in: [index.ts:278](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L278)

Converts an integer token amount to a human-readable decimal string.

This helper is kept for backwards compatibility. New code should prefer
[fromStroops](fromStroops.md), which validates the amount type at runtime.

## Parameters

### amount

`bigint`

Non-negative scaled integer amount.

### decimals?

`number` = `7`

Number of decimal places used by the token. Defaults to `7`.

## Returns

`string`

Decimal string with trailing fractional zeroes removed.

## Throws

If `amount` is negative.
