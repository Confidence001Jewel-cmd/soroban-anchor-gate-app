# Bundle size and tree-shaking

## Analyzing the web bundle

```bash
cd apps/web
npm run analyze        # interactive Turbopack bundle analyzer (next analyze)
npm run build && npm run bundle-size   # gzip report + budget check
```

`npm run bundle-size` sums the gzip size of every client chunk in `.next/static`
and fails when the total exceeds the budget (450 KB by default; override with
`BUNDLE_BUDGET_KB` or a CLI argument). CI runs it after the production build.
The analyzer is the one built into Next.js, so no extra dependency is needed.

Baseline at the time of writing: ~337 KB gzip total client JS, dominated by
`@stellar/stellar-sdk`.

## Tree-shaking

- The web app imports only named symbols from `@stellar/stellar-sdk`
  (`StrKey`, `rpc`, `Address`, ...). Keep it that way; never use
  `import * as StellarSdk`.
- `@soroban-anchor-gate/contract-client` declares `"sideEffects": false`, so
  bundlers can drop unused exports from it.
