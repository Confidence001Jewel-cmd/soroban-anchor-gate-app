[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / EscrowGateClient

# Class: EscrowGateClient

Defined in: [index.ts:314](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L314)

Client for building Soroban invocations targeting the Anchor Gate escrow
contract.

The client is stateless and does not submit transactions. It validates
inputs, encodes contract arguments with the Stellar SDK, and returns
operations that callers can add to a `TransactionBuilder`, simulate, sign,
and submit through their preferred RPC or wallet flow.

## Example

```ts
const client = new EscrowGateClient({
  contractId: "CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});

const operation = client.buildOperation(
  "get_escrow",
  client.buildGetEscrowTx(1n)
);
```

## Constructors

### Constructor

> **new EscrowGateClient**(`config`): `EscrowGateClient`

Defined in: [index.ts:324](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L324)

Creates a client and validates the supplied configuration.

#### Parameters

##### config

[`ClientConfig`](../interfaces/ClientConfig.md)

Contract ID, RPC URL, and network passphrase.

#### Returns

`EscrowGateClient`

#### Throws

If the configuration is invalid.

## Properties

### config

> `readonly` **config**: [`ClientConfig`](../interfaces/ClientConfig.md)

Defined in: [index.ts:324](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L324)

Contract ID, RPC URL, and network passphrase.

***

### contract

> `readonly` **contract**: `Contract`

Defined in: [index.ts:316](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L316)

Stellar SDK contract wrapper bound to [ClientConfig.contractId](../interfaces/ClientConfig.md#contractid).

## Methods

### buildCreateEscrowTx()

> **buildCreateEscrowTx**(`params`): `ScVal`[]

Defined in: [index.ts:366](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L366)

Builds arguments for the contract's `create_escrow` method.

#### Parameters

##### params

[`EscrowCreateParams`](../interfaces/EscrowCreateParams.md)

Payer, beneficiary, token, amount, profile hash, and lock
  duration for the new escrow.

#### Returns

`ScVal`[]

ScVal arguments in contract call order.

#### Throws

If an address is invalid, the amount or lock duration is
  not positive, or the profile hash is malformed.

***

### buildGetEscrowTx()

> **buildGetEscrowTx**(`escrowId`): `ScVal`[]

Defined in: [index.ts:499](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L499)

Builds arguments for the contract's `get_escrow` query.

#### Parameters

##### escrowId

`bigint`

Identifier of the escrow to read.

#### Returns

`ScVal`[]

ScVal arguments containing the escrow ID.

#### Throws

If `escrowId` is negative.

***

### buildInitTx()

> **buildInitTx**(`admin`, `treasury`, `feeBps`): `ScVal`[]

Defined in: [index.ts:339](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L339)

Builds arguments for the contract's `init` method.

#### Parameters

##### admin

`string`

Stellar account that will administer the contract.

##### treasury

`string`

Stellar account that receives protocol fees.

##### feeBps

`number`

Protocol fee in basis points, from `0` to `1000`.

#### Returns

`ScVal`[]

ScVal arguments in contract call order.

#### Throws

If an address is invalid or `feeBps` is out of range or
  not an integer.

***

### buildIsTokenWhitelistedTx()

> **buildIsTokenWhitelistedTx**(`token`): `ScVal`[]

Defined in: [index.ts:513](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L513)

Builds arguments for the contract's `is_token_whitelisted` query.

#### Parameters

##### token

`string`

Token contract address to check.

#### Returns

`ScVal`[]

ScVal arguments containing the token address.

#### Throws

If `token` is not a valid Stellar address.

***

### buildOperation()

> **buildOperation**(`method`, `args`): `Operation`

Defined in: [index.ts:527](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L527)

Creates a Soroban contract invocation operation for a supported method.

#### Parameters

##### method

`"init"` \| `"create_escrow"` \| `"release_to_anchor"` \| `"refund"` \| `"resolve_dispute"` \| `"set_token_whitelist"` \| `"is_token_whitelisted"` \| `"get_escrow"` \| `"get_counter"` \| `"get_admin"` \| `"get_treasury"` \| `"get_fee_bps"`

Contract method name to invoke.

##### args

`ScVal`[]

ScVal arguments produced by one of the `build*Tx` helpers.

#### Returns

`Operation`

An operation ready to be added to a `TransactionBuilder`.

***

### buildRefundTx()

> **buildRefundTx**(`escrowId`): `ScVal`[]

Defined in: [index.ts:429](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L429)

Builds arguments for the contract's `refund` method.

#### Parameters

##### escrowId

`bigint`

Identifier of the escrow to refund.

#### Returns

`ScVal`[]

ScVal arguments containing the escrow ID.

#### Throws

If `escrowId` is negative.

***

### buildReleaseToAnchorTx()

> **buildReleaseToAnchorTx**(`params`): `ScVal`[]

Defined in: [index.ts:404](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L404)

Builds arguments for the contract's `release_to_anchor` method.

#### Parameters

##### params

[`ReleaseToAnchorParams`](../interfaces/ReleaseToAnchorParams.md)

Escrow identifier, authorized caller, and anchor
  disbursement address.

#### Returns

`ScVal`[]

ScVal arguments in contract call order.

#### Throws

If the caller or disbursement address is invalid.

***

### buildResolveDisputeTx()

> **buildResolveDisputeTx**(`params`): `ScVal`[]

Defined in: [index.ts:445](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L445)

Builds arguments for the contract's `resolve_dispute` method.

#### Parameters

##### params

[`ResolveDisputeParams`](../interfaces/ResolveDisputeParams.md)

Escrow identifier, authorized caller, and payer and
  beneficiary shares in basis points.

#### Returns

`ScVal`[]

ScVal arguments in contract call order.

#### Throws

If the escrow ID is negative, the caller is invalid, or the
  split is negative or does not sum to exactly 10,000 basis points.

***

### buildSetTokenWhitelistTx()

> **buildSetTokenWhitelistTx**(`params`): `ScVal`[]

Defined in: [index.ts:476](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L476)

Builds arguments for the contract's `set_token_whitelist` method.

#### Parameters

##### params

[`SetTokenWhitelistParams`](../interfaces/SetTokenWhitelistParams.md)

Caller, token address, and new whitelist status.

#### Returns

`ScVal`[]

ScVal arguments in contract call order.

#### Throws

If the caller or token address is invalid.

***

### decodeContractResult()

> **decodeContractResult**(`scVal`): `any`

Defined in: [index.ts:596](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L596)

Converts a contract return ScVal into its native JavaScript value.

#### Parameters

##### scVal

`ScVal`

Return value produced by a contract simulation or
  transaction result.

#### Returns

`any`

The native value decoded by the Stellar SDK. Integers are returned
  as `bigint`; structured contract values are returned as objects or
  arrays.

***

### parseEscrowRecord()

> **parseEscrowRecord**(`rawVal`): [`EscrowRecordView`](../interfaces/EscrowRecordView.md)

Defined in: [index.ts:554](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L554)

Parses a raw `get_escrow` response into an [EscrowRecordView](../interfaces/EscrowRecordView.md).

#### Parameters

##### rawVal

`ScVal`

ScVal returned by the contract.

#### Returns

[`EscrowRecordView`](../interfaces/EscrowRecordView.md)

Decoded escrow record with addresses, amount, hash, status, and
  unlock timestamp.

#### Throws

If `rawVal` does not decode to an escrow record object.
