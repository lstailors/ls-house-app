import { describe, expect, test } from "bun:test";
import { formatLookbookUSD, lookbookDownloadHref, deskSwatchUrl, swatchDetailPath, swatchListPath } from "./lookbook-shared";

describe("formatLookbookUSD", () => {
  test("keeps cents that house formatUSD would round away", () => {
    expect(formatLookbookUSD(192.3077)).toBe("$192.31");
    expect(formatLookbookUSD(56.4103)).toBe("$56.41");
    expect(formatLookbookUSD(90)).toBe("$90.00");
  });
});

describe("lookbook links", () => {
  test("download stays on-app so the browser can save the file", () => {
    expect(lookbookDownloadHref("ARTEXTILE-109301")).toBe(
      "/api/lookbook-prices/photo?id=ARTEXTILE-109301",
    );
  });
  test("Desk click-through uses the fabric-swatch form", () => {
    expect(deskSwatchUrl("ARTEXTILE-109301")).toBe(
      "https://erp.lstailors.com/desk/fabric-swatch/ARTEXTILE-109301",
    );
  });
  test("encodes Marzoni slashes in the query", () => {
    expect(lookbookDownloadHref("120-721/700")).toContain("120-721%2F700");
  });
  test("detail path can carry the gallery filters back", () => {
    expect(swatchDetailPath("ARTEXTILE-109301", "mill=Artextile&photo=1")).toBe(
      "/admin/reference/lookbook-prices/swatch?id=ARTEXTILE-109301&back=mill%3DArtextile%26photo%3D1",
    );
    expect(swatchListPath("mill=Artextile&photo=1")).toBe(
      "/admin/reference/lookbook-prices/all?mill=Artextile&photo=1",
    );
  });
});
