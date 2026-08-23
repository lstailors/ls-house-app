#!/usr/bin/env bun
/**
 * House lookbook price match report (read-only).
 * Run: bun run src/scripts/lookbook-price-report.ts
 * Requires ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET.
 *
 * Prints per-mill BOOK / JOINED (Fabric Buying USD) / CONFLICT / NO LISTINO,
 * plus the LSH Fabric Pricing gap panel. Writes nothing to Desk.
 */
import "../load-env";
import { fetchLookbookPriceReview } from "../lib/lookbook-prices";

const review = await fetchLookbookPriceReview();

const pad = (v: string | number, w: number) => String(v).padStart(w);
console.log(`Generated ${review.generatedAt}`);
console.log(
  `Totals: swatches ${review.totals.swatches} (SW- excluded ${review.totals.swExcluded}) | ` +
    `book ${review.totals.book} | joined ${review.totals.joined} (${review.totals.joinedPending} pending) | ` +
    `conflict ${review.totals.conflict} | no listino ${review.totals.noListino}`,
);
const bucketSum =
  review.totals.book + review.totals.joined + review.totals.conflict + review.totals.noListino;
console.log(
  `Reconciliation: buckets ${bucketSum} vs swatches-minus-SW ${review.totals.swatches - review.totals.swExcluded} ` +
    (bucketSum === review.totals.swatches - review.totals.swExcluded ? "✓" : "✗ MISMATCH"),
);

console.log(`\n${"Mill".padEnd(28)}${pad("Swatch", 8)}${pad("Book", 8)}${pad("Joined", 8)}${pad("Pend", 6)}${pad("Confl", 7)}${pad("NoList", 8)}`);
for (const m of review.mills) {
  console.log(
    m.mill.padEnd(28) +
      pad(m.swatchCount, 8) +
      pad(m.buckets.book, 8) +
      pad(m.buckets.joined, 8) +
      pad(m.buckets.joinedPending, 6) +
      pad(m.buckets.conflict, 7) +
      pad(m.buckets.noListino, 8),
  );
}

console.log(`\nLSH Fabric Pricing gap (${"mill / rows / keys / internal conflicts / reaches lookbook"}):`);
for (const g of review.lshGap) {
  console.log(
    g.mill.padEnd(28) + pad(g.rows, 6) + pad(g.distinctKeys, 6) + pad(g.internalConflicts, 6) + `   ${g.reachable ? "yes" : "no"}`,
  );
}
