// Reports gzip'd client JS size from a finished `next build` and enforces a budget.
// Usage: node scripts/bundle-size.mjs [budgetKB]   (default budget: 450 KB gzip total)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(process.cwd(), ".next", "static");
const budgetKB = Number(process.argv[2] ?? process.env.BUNDLE_BUDGET_KB ?? 450);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let files;
try {
  files = walk(root).filter((f) => f.endsWith(".js"));
} catch {
  console.error("No .next/static found. Run `npm run build` first.");
  process.exit(2);
}

const rows = files
  .map((f) => {
    const raw = readFileSync(f);
    return { file: f.slice(root.length + 1), raw: raw.length, gzip: gzipSync(raw).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

const kb = (n) => (n / 1024).toFixed(1).padStart(8) + " KB";
console.log("gzip       raw        chunk");
for (const r of rows.slice(0, 10)) console.log(kb(r.gzip), kb(r.raw), r.file);
const total = rows.reduce((s, r) => s + r.gzip, 0);
console.log(`\nTotal client JS (gzip): ${(total / 1024).toFixed(1)} KB (budget ${budgetKB} KB)`);
if (total / 1024 > budgetKB) {
  console.error("Bundle budget exceeded.");
  process.exit(1);
}
