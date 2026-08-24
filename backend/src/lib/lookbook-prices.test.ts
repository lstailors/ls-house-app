import { describe, expect, test } from "bun:test";
import {
  articleFromItemCode,
  buildArticleRates,
  bucketSwatch,
  computeData,
  computeReview,
  searchSwatches,
  type ItemPriceRow,
  type SwatchRow,
} from "./lookbook-prices";

const swatch = (over: Partial<SwatchRow>): SwatchRow => ({
  swatch_number: "TEST-1",
  mill: "Testmill",
  collection: null,
  fabric_article_id: null,
  fabric_name: null,
  price_per_meter: 0,
  swatch_photo_url: null,
  ...over,
});

describe("articleFromItemCode", () => {
  test("strips FAB-<code>- prefix", () => {
    expect(articleFromItemCode("FAB-COL-109301")).toBe("109301");
    expect(articleFromItemCode("FAB-SOL-NS04005")).toBe("NS04005");
    expect(articleFromItemCode("FAB-STV-353107")).toBe("353107");
    expect(articleFromItemCode("FAB-GV-502353")).toBe("502353");
    expect(articleFromItemCode("FAB-FW24-N763009")).toBe("N763009");
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

  test("does not join a colorway-suffixed lookbook article to a mill-only item code", () => {
    const tallia = buildArticleRates([{ item_code: "FAB-TAL-7048M", price_list_rate: 90 }]);
    // Live Desk: lookbook article is 07048M-0300-0001, item code article is 7048M.
    expect(bucketSwatch(swatch({ fabric_article_id: "07048M-0300-0001", price_per_meter: 90 }), tallia).bucket).toBe(
      "book",
    );
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

describe("computeData rows and searchSwatches", () => {
  const data = computeData(
    [
      swatch({ swatch_number: "ARTEXTILE-109301", mill: "Artextile", fabric_article_id: "109301", price_per_meter: 192.3077 }),
      swatch({ swatch_number: "ARTEXTILE-100200", mill: "Artextile", fabric_article_id: "100200" }),
      swatch({ swatch_number: "SAVIERO-100100", mill: "Saviero", fabric_article_id: "100100", price_per_meter: 720, fabric_name: "Zegna Tropical" }),
      swatch({ swatch_number: "HS-2111001", mill: "Holland & Sherry", collection: "HS2111" }),
      swatch({ swatch_number: "SW-1", mill: "House" }),
    ],
    [{ item_code: "FAB-COL-109301", price_list_rate: 192.3077 }],
    [],
  );

  test("rows exclude SW- and index by swatch number", () => {
    expect(data.rows.length).toBe(4);
    expect(data.bySwatch.has("SW-1")).toBe(false);
    expect(data.bySwatch.get("ARTEXTILE-109301")!.bucket).toBe("joined");
    expect(data.bySwatch.get("SAVIERO-100100")!.bucket).toBe("book");
  });

  test("empty query lists all, sorted, paginated", () => {
    const page = searchSwatches(data.rows, { start: 1, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.rows.map((r) => r.swatchNumber)).toEqual(["ARTEXTILE-109301", "HS-2111001"]);
  });

  test("mill and bucket filters apply", () => {
    expect(searchSwatches(data.rows, { mill: "Artextile" }).total).toBe(2);
    expect(searchSwatches(data.rows, { bucket: "joined" }).total).toBe(1);
  });

  test("prefix beats substring beats subsequence", () => {
    const out = searchSwatches(data.rows, { q: "109301" });
    expect(out.rows[0]!.swatchNumber).toBe("ARTEXTILE-109301"); // article prefix match
    const sub = searchSwatches(data.rows, { q: "ART1093" }); // subsequence only
    expect(sub.total).toBe(1);
    expect(sub.rows[0]!.swatchNumber).toBe("ARTEXTILE-109301");
  });

  test("matches collection and fabric name", () => {
    expect(searchSwatches(data.rows, { q: "zegna" }).rows[0]!.swatchNumber).toBe("SAVIERO-100100");
    expect(searchSwatches(data.rows, { q: "hs2111" }).rows[0]!.swatchNumber).toBe("HS-2111001");
  });

  test("no match returns empty, short query lists", () => {
    expect(searchSwatches(data.rows, { q: "zzzzzz" }).total).toBe(0);
    expect(searchSwatches(data.rows, { q: "z" }).total).toBe(4); // <2 chars -> listing
  });
});
