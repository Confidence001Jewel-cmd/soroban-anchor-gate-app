[**Soroban Anchor Gate Contract Client SDK v0.1.0**](../README.md)

***

[Soroban Anchor Gate Contract Client SDK](../README.md) / validateClientConfig

# Function: validateClientConfig()

> **validateClientConfig**(`config`): `void`

Defined in: [index.ts:177](https://github.com/Nwoyemartha/soroban-anchor-gate-app/blob/e2db87fa61a315f6f2404b6aff16abb1c586d189/packages/contract-client/src/index.ts#L177)

Validates the connection settings for an [EscrowGateClient](../classes/EscrowGateClient.md).

## Parameters

### config

[`ClientConfig`](../interfaces/ClientConfig.md)

Client configuration to validate.

## Returns

`void`

## Throws

If the contract ID, RPC URL, or network passphrase is
  missing or malformed.

## Example

```ts
validateClientConfig({
  contractId: "CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});
```
