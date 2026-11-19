[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / parseAnchorQuoteServerFromToml

# Function: parseAnchorQuoteServerFromToml()

> **parseAnchorQuoteServerFromToml**(`toml`): `string` \| `undefined`

Defined in: sep38.ts:113

Extracts the `ANCHOR_QUOTE_SERVER` value from the top-level table of a
`stellar.toml` document.

This intentionally small TOML reader handles the subset of the format used
by SEP-1 discovery: comments, table headers, bare keys, basic strings, and
literal strings. Other sections are ignored.

## Parameters

### toml

`string`

Raw `stellar.toml` contents.

## Returns

`string` \| `undefined`

The configured quote server URL, or `undefined` when the key is
  absent.

## Throws

If `ANCHOR_QUOTE_SERVER` is present but is not a string.
