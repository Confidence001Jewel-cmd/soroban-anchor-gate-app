[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / toStroops

# Function: toStroops()

> **toStroops**(`amount`, `decimals?`): `bigint`

Defined in: units.ts:95

Converts a human-readable token amount into its scaled integer
representation.

The conversion is exact: the input is parsed as a decimal string and scaled
with `bigint` arithmetic, never through binary floating-point math. Strings
are the safest input for large values or values with many decimal places.
Numbers are accepted for convenience, but integers outside
`Number.MAX_SAFE_INTEGER` and values with excessively large scientific
notation exponents are rejected to avoid silent precision loss.

Fractional digits beyond `decimals` are allowed only when they are trailing
zeroes. Any value that cannot be represented without losing precision (a
sub-stroop amount) throws an error.

## Parameters

### amount

`string` \| `number`

Non-negative decimal amount, such as `"10.50"`, `10.5`, or
  `"10500000"`.

### decimals?

`number` = `DEFAULT_TOKEN_DECIMALS`

Number of decimal places used by the token. Defaults to
  [DEFAULT\_TOKEN\_DECIMALS](../variables/DEFAULT_TOKEN_DECIMALS.md) (`7`).

## Returns

`bigint`

The amount scaled by `10^decimals` as a `bigint`.

## Throws

If the amount is negative, malformed, not finite, or has
  non-zero precision below the requested number of decimal places.

## Throws

If `decimals` is not an integer between `0` and
  [MAX\_TOKEN\_DECIMALS](../variables/MAX_TOKEN_DECIMALS.md).

## Example

```ts
toStroops("10.50"); // 105_000_000n
toStroops(10.5, 7); // 105_000_000n
toStroops("0.0000001"); // 1n
toStroops("1.2345678", 7); // 12_345_678n
```
