[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / getAnchorExchangeQuote

# Function: getAnchorExchangeQuote()

> **getAnchorExchangeQuote**(`anchorDomain`, `fromAsset`, `toAsset`, `amount`, `options?`): `Promise`\<[`Sep38Quote`](../interfaces/Sep38Quote.md)\>

Defined in: sep38.ts:530

Fetches an indicative SEP-38 exchange quote from an anchor.

The helper performs SEP-38 discovery automatically:

1. Fetches `/.well-known/stellar.toml` from `anchorDomain`.
2. Reads the `ANCHOR_QUOTE_SERVER` table entry.
3. Calls `GET <quote server>/price` with `sell_asset`, `buy_asset`, and
   `sell_amount` query parameters.

The function does not create a firm quote and does not require SEP-10
authentication. If an anchor requires authentication for personalized
pricing, pass a token via [AnchorQuoteRequestOptions.authToken](../interfaces/AnchorQuoteRequestOptions.md#authtoken).

## Parameters

### anchorDomain

`string`

Anchor hostname such as `"testanchor.stellar.org"`, or
  an absolute `http(s)` URL.

### fromAsset

`string`

Asset sold by the client, in SEP-38 format such as
  `"stellar:USDC:GA5Z...ZVN"` or `"iso4217:USD"`.

### toAsset

`string`

Asset bought by the client, in SEP-38 format.

### amount

`string` \| `number` \| `bigint`

Amount of `fromAsset` to sell, as a non-negative decimal
  string, number, or `bigint`.

### options?

[`AnchorQuoteRequestOptions`](../interfaces/AnchorQuoteRequestOptions.md) = `{}`

Optional context, delivery methods, country code,
  authentication token, custom fetch implementation, headers, and abort
  signal.

## Returns

`Promise`\<[`Sep38Quote`](../interfaces/Sep38Quote.md)\>

A strongly typed [Sep38Quote](../interfaces/Sep38Quote.md).

## Throws

If inputs are empty or invalid, discovery fails, the anchor
  returns an error, or the response is missing required fields.

## Example

```ts
const quote = await getAnchorExchangeQuote(
  "testanchor.stellar.org",
  "iso4217:USD",
  "stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "100.00",
  { context: "sep31" }
);

console.log(quote.totalPrice, quote.buyAmount);
```
