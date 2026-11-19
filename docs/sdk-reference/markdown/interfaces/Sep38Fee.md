[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / Sep38Fee

# Interface: Sep38Fee

Defined in: sep38.ts:30

Fee breakdown returned by a SEP-38 price or quote response.

## Properties

### asset

> **asset**: `string`

Defined in: sep38.ts:34

Asset in which the fee is denominated, in SEP-38 asset format.

***

### details?

> `optional` **details?**: [`Sep38FeeDetail`](Sep38FeeDetail.md)[]

Defined in: sep38.ts:36

Optional individual fee components that make up [Sep38Fee.total](#total).

***

### total

> **total**: `string`

Defined in: sep38.ts:32

Total fee amount across all [Sep38Fee.details](#details).
