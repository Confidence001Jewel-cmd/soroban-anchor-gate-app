[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / fromStroops

# Function: fromStroops()

> **fromStroops**(`amount`, `decimals?`): `string`

Defined in: units.ts:191

Formats a scaled integer token amount as an exact, human-readable decimal
string.

Trailing fractional zeroes are removed, so `10_500_000n` becomes `"10.5"` at
the default seven decimal places. The output can be passed back to
[toStroops](toStroops.md) without losing precision.

## Parameters

### amount

`bigint`

Non-negative scaled integer amount, typically a Soroban
  `i128` value or a stroop count.

### decimals?

`number` = `DEFAULT_TOKEN_DECIMALS`

Number of decimal places used by the token. Defaults to
  [DEFAULT\_TOKEN\_DECIMALS](../variables/DEFAULT_TOKEN_DECIMALS.md) (`7`).

## Returns

`string`

The decimal string representation of `amount`.

## Throws

If `amount` is not a `bigint`, is negative, or if `decimals`
  is not an integer between `0` and [MAX\_TOKEN\_DECIMALS](../variables/MAX_TOKEN_DECIMALS.md).

## Example

```ts
fromStroops(105_000_000n); // "10.5"
fromStroops(1n); // "0.0000001"
fromStroops(1_050n, 2); // "10.5"
```
