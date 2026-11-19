[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / Sep38FeeDetail

# Interface: Sep38FeeDetail

Defined in: sep38.ts:18

Fee line item returned by a SEP-38 price or quote response.

## Properties

### amount

> **amount**: `string`

Defined in: sep38.ts:24

Fee amount in the asset identified by [Sep38Fee.asset](Sep38Fee.md#asset).

***

### description?

> `optional` **description?**: `string`

Defined in: sep38.ts:22

Optional explanation of how the fee is calculated.

***

### name

> **name**: `string`

Defined in: sep38.ts:20

Human-readable fee name, such as `"PIX fee"` or `"Service fee"`.
