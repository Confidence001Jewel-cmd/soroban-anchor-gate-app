# Soroban Contract WASM Size & Gas Benchmarks

**Target Contract:** `soroban-anchor-escrow`  
**Soroban SDK Version:** `v22.0.11` (`soroban-env-host v22.1.3`)  
**Rust Target:** `wasm32-unknown-unknown` (`--release`)  
**Network Compatibility:** Stellar Protocol 22 / Testnet / Mainnet  
**Benchmark Harness:** `contracts/src/test.rs` → `test_gas_benchmark_*`

---

## 1. WASM Artifact Size Metrics

| Artifact Stage | File Size (Bytes) | Size (KB) | SHA-256 Digest |
| :--- | :--- | :--- | :--- |
| **Release Build** (`cargo build --release`) | 17,197 bytes | 16.79 KB | `9982de7dd60f2054e1836d6b4414427cf06d55450187c95fb9dc3abe09533d88` |
| **Optimized Build** (`stellar contract optimize`) | 13,942 bytes | 13.62 KB | `b308dbbac73dd12af4a2eba30022aca4937daf73b8976b2b1457c8d2e4f161cf` |

| Revision | Release Build | Delta |
| :--- | :--- | :--- |
| Before `release_split` + `get_escrows_paginated` | 12,306 bytes | — |
| Current | 17,197 bytes | +4,891 bytes (+39.7%) |

> **Analysis**: Adding two entrypoints (multi-leg split payouts and the paginated audit export) grows the binary by ~4.8 KB. The optimized artifact (~13.6 KB) remains roughly 5× below Stellar's 64 KB contract code ceiling.
>
> Digests were produced with `rustc 1.97.1`; a different compiler version will yield different digests. Re-run the commands in [§6](#6-reproducing-the-benchmarks) before relying on them for deployment verification.

---

## 2. Methodology — Budget-Metered Profiling Harness

The benchmarks are ordinary `cargo test` cases, so they run on every CI build and **fail the build** if any entrypoint regresses past the headroom target.

1. Each scenario runs in a fresh `Env::default()` with `mock_all_auths()` and a real Stellar Asset Contract (SAC) token, so nested token transfers and auth checks are metered.
2. The Soroban host **resets the budget before every top-level invocation**. Reading `env.cost_estimate().budget()` right after a client call therefore gives the cost of that one call. `test_gas_benchmark_metering_resets_per_invocation` checks this assumption (a getter must cost less than the `init` call made just before it).
3. For each call, the harness records:
   * `cpu_instruction_cost()`: CPU instructions metered by the host.
   * `memory_bytes_cost()`: memory bytes allocated by the host.
4. Every sample is asserted to be:
   * non-zero, which proves metering is active, and
   * **≤ 25% of the mainnet per-transaction limits** (`COMFORT_MARGIN_PERCENT`).
5. Payload-dependent entrypoints are swept across sizes, and the harness asserts that **cost increases strictly with payload size**. This catches broken metering and also accidental work being skipped.

### Mainnet reference limits (Protocol 22, per transaction)

| Resource | Limit | 25% Headroom Target |
| :--- | ---: | ---: |
| CPU instructions | 100,000,000 | 25,000,000 |
| Memory | 41,943,040 bytes (40 MiB) | 10,485,760 bytes |

### Known limitation

Tests register the contract natively (`env.register(EscrowGate, ())`), so the numbers **exclude Wasm VM instantiation and Wasm-execution overhead**. They also exclude ledger I/O fees, rent, and transaction-size fees. Treat them as the host-function cost floor. The 25% headroom target leaves a ≥4× margin to absorb that overhead. Use `stellar contract invoke --sim-only` against a deployment to get exact fee quotes.

---

## 3. Core Lifecycle Entrypoints

| Entrypoint | Payload | CPU Instructions | Memory (Bytes) | % CPU Limit | % Mem Limit |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `init` | fee_bps=200 | 50,880 | 8,909 | 0.051% | 0.021% |
| `set_token_whitelist` | 1 token | 81,273 | 12,764 | 0.081% | 0.030% |
| `is_token_whitelisted` | whitelist active | 46,329 | 6,406 | 0.046% | 0.015% |
| `create_escrow` | whitelisted token | 265,804 | 44,346 | 0.266% | 0.106% |
| `release_to_anchor` | fee + payout | 401,107 | 63,137 | 0.401% | 0.151% |
| `refund` | after unlock | 233,791 | 40,073 | 0.234% | 0.096% |
| `resolve_dispute` | 40/60 split | 412,589 | 67,783 | 0.413% | 0.162% |
| `get_escrow` | 1 record | 48,336 | 7,971 | 0.048% | 0.019% |
| `get_counter` | — | 42,825 | 7,156 | 0.043% | 0.017% |
| `get_admin` | — | 41,508 | 7,063 | 0.042% | 0.017% |
| `get_treasury` | — | 41,964 | 7,063 | 0.042% | 0.017% |
| `get_fee_bps` | — | 41,838 | 7,063 | 0.042% | 0.017% |

---

## 4. Payload Scaling

### 4.1 `release_split`: multi-leg payout (Issue #70)

Each leg adds one SAC transfer and one `split_disb` event, so cost grows linearly with leg count. The count is capped at `MAX_DISBURSEMENT_COMMITMENTS = 10`.

| Entrypoint | Payload | CPU Instructions | Memory (Bytes) | % CPU Limit | % Mem Limit |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `release_split` | legs=1, fee_bps=0 | 252,249 | 39,045 | 0.252% | 0.093% |
| `release_split` | legs=2, fee_bps=0 | 393,568 | 61,023 | 0.394% | 0.145% |
| `release_split` | legs=5, fee_bps=0 | 834,703 | 129,297 | 0.835% | 0.308% |
| `release_split` | legs=10, fee_bps=0 | 1,612,041 | 250,887 | 1.612% | 0.598% |
| `release_split` | legs=10, fee_bps=1000 (worst case) | 1,770,783 | 275,990 | 1.771% | 0.658% |

**Marginal cost per leg:** ≈ 151,000 CPU instructions and ≈ 23,500 bytes.

### 4.2 `get_escrows_paginated`: audit export (Issue #72)

Each returned row costs one persistent-storage read plus record decoding. The page size is clamped to `MAX_PAGE_SIZE = 50`, so a `limit = u32::MAX` request costs the same as a full page.

| Entrypoint | Payload | CPU Instructions | Memory (Bytes) | % CPU Limit | % Mem Limit |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `get_escrows_paginated` | limit=1 | 62,249 | 14,019 | 0.062% | 0.033% |
| `get_escrows_paginated` | limit=10 | 310,139 | 37,752 | 0.310% | 0.090% |
| `get_escrows_paginated` | limit=25 | 757,419 | 83,247 | 0.757% | 0.198% |
| `get_escrows_paginated` | limit=50 | 1,586,433 | 175,572 | 1.586% | 0.419% |
| `get_escrows_paginated` | limit=u32::MAX (clamped to 50) | 1,586,311 | 175,572 | 1.586% | 0.419% |

**Marginal cost per row:** ≈ 31,000 CPU instructions and ≈ 3,300 bytes.

> **Analysis**: The most expensive entrypoint in its worst configuration (`release_split`, 10 legs plus treasury fee) uses **1.77% of the mainnet CPU limit and 0.66% of the memory limit**. That is about 14× inside the 25% headroom target. Both new loops have hard upper bounds, so no caller-supplied payload can exhaust the transaction budget.

---

## 5. Storage TTL Extension Strategy

The contract extends state lifetimes proactively so entries are not archived:

* **Instance Storage**:
  * Threshold: `100,000` ledgers (~5.7 days)
  * Extend amount: `200,000` ledgers (~11.5 days)
  * Keys: `Admin`, `Treasury`, `FeeBps`, `EscrowCounter`, `WhitelistActive`
* **Persistent Storage**:
  * Threshold: `100,000` ledgers (~5.7 days)
  * Extend amount: `200,000` ledgers (~11.5 days)
  * Keys: `Escrow(id)` records (extended on `create_escrow` and `release_split`)

`get_escrows_paginated` is strictly read-only and performs no TTL extension, so an audit query never incurs write fees. IDs with no stored record are skipped rather than failing the whole page.

---

## 6. Reproducing the Benchmarks

```bash
cd contracts

# Gas tables (prints markdown rows identical to §3 and §4)
cargo test gas_benchmark -- --nocapture --test-threads=1

# WASM size & digest
cargo build --target wasm32-unknown-unknown --release
wc -c target/wasm32-unknown-unknown/release/soroban_anchor_escrow.wasm
sha256sum target/wasm32-unknown-unknown/release/soroban_anchor_escrow.wasm

# Optimized artifact (requires the Stellar CLI)
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/soroban_anchor_escrow.wasm
wc -c target/wasm32-unknown-unknown/release/soroban_anchor_escrow.optimized.wasm
```

---

## 7. Historical Testnet Profile (pre-#70 / #72)

Kept for reference. These numbers came from Testnet execution of `CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT` and include Wasm VM overhead, which explains why they are higher than the host-metered figures above:

| Contract Function | CPU Instructions | Memory Footprint (Bytes) | Read Footprint (Entries) | Write Footprint (Entries) | Base Fee (Stroops) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `init` | 148,205 | 28,450 | 2 (`Admin`, `Treasury`) | 4 (`Admin`, `Treasury`, `FeeBps`, `EscrowCounter`) | 100 |
| `create_escrow` | 382,140 | 64,820 | 4 (`Admin`, `FeeBps`, `EscrowCounter`, `TokenSAC`) | 2 (`EscrowCounter`, `Escrow(id)`) | 100 |
| `release_to_anchor` | 425,890 | 72,110 | 4 (`Admin`, `Treasury`, `FeeBps`, `Escrow(id)`) | 1 (`Escrow(id)`) | 100 |
| `refund` | 295,410 | 49,600 | 2 (`Escrow(id)`, `LedgerTime`) | 1 (`Escrow(id)`) | 100 |
| `resolve_dispute` | 412,650 | 68,900 | 2 (`Admin`, `Escrow(id)`) | 1 (`Escrow(id)`) | 100 |
| `set_token_whitelist` | 185,320 | 31,200 | 2 (`Admin`, `Token`) | 2 (`TokenWhitelisted`, `WhitelistActive`) | 100 |
| `get_escrow` | 74,100 | 18,250 | 1 (`Escrow(id)`) | 0 (Read-only) | 100 |
