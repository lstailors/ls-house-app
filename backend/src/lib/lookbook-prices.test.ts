import { describe, expect, test } from "bun:test";
import {
  articleFromItemCode,
  buildArticleRates,
  bucketSwatch,
  computeReview,
  type ItemPriceRow,
  type SwatchRow,
} from "./lookbook-prices";

const swatch = (over: Partial<SwatchRow>): SwatchRow => ({
  swatch_number: "TEST-1",
  mill: "Testmill",
  collection: null,
  fabric_article_id: null,
  price_per_meter: 0,
  swatch_photo_url: null,
  ...over,
});

describe("articleFromItemCode", () => {
  test("strips FAB-<code>- prefix", () => {
    expect(articleFromItemCode("FAB-COL-109301")).toBe("109301");
    expect(articleFromItemCode("FAB-SOL-NS04005")).toBe("NS04005");
    expect(articleFromItemCode("FAB-STV-353107")).toBe("353107");
  });
  test("rejects legacy codes without an article part", () => {
    expect(articleFromItemCode("FAB-00001")).toBeNull();
    expect(articleFromItemCode("SEED-POLO-NAVY")).toBeNull();
  });
});

describe("bucketSwatch", () => {
  const rates = buildArticleRates([
    { item_code: "FAB-COL-109301", price_list_rate: 192.3077 },
    { item_code: "FAB-ART-DUP1", price_list_rate: 100 },
    { item_code: "FAB-HES-DUP1", price_list_rate: 120 },
  ] satisfies ItemPriceRow[]);

  test("JOINED when price matches the single USD rate", () => {
    const r = bucketSwatch(swatch({ fabric_article_id: "109301", price_per_meter: 192.3077 }), rates);
    expect(r.bucket).toBe("joined");
    expect(r.pending).toBe(false);
  });

  test("JOINED pending when article matches but price not yet written", () => {
    const r = bucketSwatch(swatch({ fabric_article_id: "109301", price_per_meter: 0 }), rates);
    expect(r.bucket).toBe("joined");
    expect(r.pending).toBe(true);
    expect(r.joinRate).toBe(192.3077);
  });

  test("CONFLICT when mill book and USD rate disagree", () => {
    const r = bucketSwatch(swatch({ fabric_article_id: "109301", price_per_meter: 80 }), rates);
    expect(r.bucket).toBe("conflict");
    expect(r.conflictRates).toEqual([80, 192.3077]);
  });

  test("CONFLICT when two USD rates collide on the same article", () => {
    const r = bucketSwatch(swatch({ fabric_article_id: "DUP1", price_per_meter: 0 }), rates);
    expect(r.bucket).toBe("conflict");
    expect(r.conflictRates).toEqual([100, 120]);
  });

  test("BOOK when priced with no article match", () => {
    expect(bucketSwatch(swatch({ fabric_article_id: "ZZZ", price_per_meter: 80 }), rates).bucket).toBe("book");
  });

  test("NO LISTINO when blank with no match — never invents", () => {
    expect(bucketSwatch(swatch({ fabric_article_id: "ZZZ" }), rates).bucket).toBe("noListino");
  });
});

describe("computeReview", () => {
  test("buckets sum to swatches minus SW- exclusions", () => {
    const review = computeReview(
      [
        swatch({ swatch_number: "SW-1", mill: "House" }),
        swatch({ swatch_number: "A-1", mill: "M1", price_per_meter: 50 }),
        swatch({ swatch_number: "A-2", mill: "M1" }),
        swatch({ swatch_number: "A-3", mill: "M2", fabric_article_id: "109301" }),
      ],
      [{ item_code: "FAB-COL-109301", price_list_rate: 192.3077 }],
      [
        { fabric_name: "K", mill: "M1", price: 10 },
        { fabric_name: "K", mill: "M1", price: 10 }, // identical dup — not a conflict
        { fabric_name: "K2", mill: "M1", price: 10 },
        { fabric_name: "K2", mill: "M1", price: 12 }, // real internal conflict
        { fabric_name: "K3", mill: "Unreach", price: 5 },
      ],
    );
    const { totals } = review;
    expect(totals.swExcluded).toBe(1);
    expect(totals.book + totals.joined + totals.conflict + totals.noListino).toBe(
      totals.swatches - totals.swExcluded,
    );
    expect(totals.joinedPending).toBe(1);

    const m1 = review.lshGap.find((g) => g.mill === "M1")!;
    expect(m1.rows).toBe(4);
    expect(m1.distinctKeys).toBe(2);
    expect(m1.internalConflicts).toBe(1);
    expect(m1.reachable).toBe(true);
    expect(review.lshGap.find((g) => g.mill === "Unreach")!.reachable).toBe(false);
  });

  test("photo urls only surface /lookbook/ paths", () => {
    const review = computeReview(
      [
        swatch({ swatch_number: "A-1", mill: "M1", price_per_meter: 5, swatch_photo_url: "/lookbook/tallia/images/x.jpg" }),
        swatch({ swatch_number: "A-2", mill: "M1", price_per_meter: 5, swatch_photo_url: "https://cdn.example.com/x.jpg" }),
      ],
      [],
      [],
    );
    const examples = review.mills[0]!.examples.book;
    expect(examples[0]!.photoUrl).toBe("/lookbook/tallia/images/x.jpg");
    expect(examples[1]!.photoUrl).toBeNull();
  });
});
