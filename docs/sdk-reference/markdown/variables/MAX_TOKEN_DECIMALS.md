[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / MAX\_TOKEN\_DECIMALS

# Variable: MAX\_TOKEN\_DECIMALS

> `const` **MAX\_TOKEN\_DECIMALS**: `255` = `255`

Defined in: units.ts:28

Maximum number of decimal places accepted by [toStroops](../functions/toStroops.md) and
[fromStroops](../functions/fromStroops.md).

The limit keeps exponentiation bounded while remaining far above the
precision used by Stellar assets or common anchored fiat currencies.
