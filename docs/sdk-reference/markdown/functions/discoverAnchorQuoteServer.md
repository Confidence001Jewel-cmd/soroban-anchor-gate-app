[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / discoverAnchorQuoteServer

# Function: discoverAnchorQuoteServer()

> **discoverAnchorQuoteServer**(`anchorDomain`, `options?`): `Promise`\<`string`\>

Defined in: sep38.ts:456

Discovers an anchor's SEP-38 quote server from its `stellar.toml` file.

The discovery URL is `https://<anchorDomain>/.well-known/stellar.toml`
unless the caller supplies an explicit `http://` or `https://` URL. The
returned server URL is resolved against the anchor URL so relative values
remain usable.

## Parameters

### anchorDomain

`string`

Anchor hostname such as `"testanchor.stellar.org"` or
  an absolute `http(s)` URL.

### options?

[`AnchorQuoteRequestOptions`](../interfaces/AnchorQuoteRequestOptions.md) = `{}`

Optional fetch implementation, headers, and abort signal.

## Returns

`Promise`\<`string`\>

The absolute SEP-38 quote server base URL.

## Throws

If the domain is invalid, discovery fails, or
  `ANCHOR_QUOTE_SERVER` is missing or malformed.
