[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / parseTokenAmount

# Function: parseTokenAmount()

> **parseTokenAmount**(`amountStr`, `decimals?`): `bigint`

Defined in: [index.ts:247](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L247)

Converts a human-readable token amount to its integer representation.

This helper is kept for backwards compatibility. New code should prefer
[toStroops](toStroops.md), which supports exact decimal exponents and reports
sub-stroop precision explicitly.

## Parameters

### amountStr

`string`

Non-negative decimal amount string.

### decimals?

`number` = `7`

Number of decimal places used by the token. Defaults to `7`.

## Returns

`bigint`

The amount scaled by `10^decimals`.

## Throws

If the amount is empty, negative, non-numeric, or has more
  fractional digits than `decimals`.
