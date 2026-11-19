[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / AnchorQuoteRequestOptions

# Interface: AnchorQuoteRequestOptions

Defined in: sep38.ts:72

Options for [getAnchorExchangeQuote](../functions/getAnchorExchangeQuote.md).

## Properties

### authToken?

> `optional` **authToken?**: `string`

Defined in: sep38.ts:87

Optional SEP-10 JWT used to personalize the indicative price.

***

### buyDeliveryMethod?

> `optional` **buyDeliveryMethod?**: `string`

Defined in: sep38.ts:85

Optional delivery method used when buying an off-chain asset.

***

### context?

> `optional` **context?**: [`Sep38QuoteContext`](../type-aliases/Sep38QuoteContext.md)

Defined in: sep38.ts:79

Optional SEP-38 context identifying how the quote will be used.

***

### countryCode?

> `optional` **countryCode?**: `string`

Defined in: sep38.ts:81

Optional ISO 3166-2 or ISO-3166-1 alpha-2 country code.

***

### fetch?

> `optional` **fetch?**: \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

Defined in: sep38.ts:77

Custom `fetch` implementation. Useful for tests, server-side proxies, or
instrumented browser clients. Defaults to the global `fetch`.

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`URL` \| `RequestInfo`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

***

### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: sep38.ts:89

Additional HTTP headers to include on both discovery and quote requests.

***

### sellDeliveryMethod?

> `optional` **sellDeliveryMethod?**: `string`

Defined in: sep38.ts:83

Optional delivery method used when selling an off-chain asset.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: sep38.ts:91

Optional abort signal used to cancel discovery and quote requests.
