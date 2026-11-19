[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / Sep38Quote

# Interface: Sep38Quote

Defined in: sep38.ts:43

Strongly typed indicative exchange quote produced by
[getAnchorExchangeQuote](../functions/getAnchorExchangeQuote.md).

## Properties

### anchorDomain

> **anchorDomain**: `string`

Defined in: sep38.ts:45

Normalized anchor host used for SEP-1 discovery.

***

### buyAmount

> **buyAmount**: `string`

Defined in: sep38.ts:59

Amount of `buyAsset` the anchor will provide.

***

### buyAsset

> **buyAsset**: `string`

Defined in: sep38.ts:57

Asset being bought, in SEP-38 asset identification format.

***

### fee?

> `optional` **fee?**: [`Sep38Fee`](Sep38Fee.md)

Defined in: sep38.ts:61

Optional fee breakdown returned by the anchor.

***

### price

> **price**: `string`

Defined in: sep38.ts:51

Price excluding fees, for one unit of the buy asset.

***

### quoteServer

> **quoteServer**: `string`

Defined in: sep38.ts:47

SEP-38 quote server base URL discovered from `stellar.toml`.

***

### sellAmount

> **sellAmount**: `string`

Defined in: sep38.ts:55

Amount of `sellAsset` the anchor will exchange.

***

### sellAsset

> **sellAsset**: `string`

Defined in: sep38.ts:53

Asset being sold, in SEP-38 asset identification format.

***

### totalPrice

> **totalPrice**: `string`

Defined in: sep38.ts:49

Total price including fees, for one unit of the buy asset.
