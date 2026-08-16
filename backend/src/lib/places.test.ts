import { describe, expect, test } from "bun:test";
import {
  buildSearchQuery,
  distinctiveStreetTokens,
  rankSuggestions,
  scoreSuggestion,
  type PlaceSuggestion,
} from "./places";

const tanglewood: PlaceSuggestion = {
  id: "good",
  label: "782 Tanglewood Road, West Islip, NY, 11795",
  street: "782 Tanglewood Road",
  city: "West Islip",
  state: "NY",
  zip: "11795",
};

const troy: PlaceSuggestion = {
  id: "troy",
  label: "782 3rd Avenue, Troy, NY, 12182",
  street: "782 3rd Avenue",
  city: "Troy",
  state: "NY",
  zip: "12182",
};

const chula: PlaceSuggestion = {
  id: "ca",
  label: "782 3rd Avenue, Chula Vista, California, 91911",
  street: "782 3rd Avenue",
  city: "Chula Vista",
  state: "CA",
  zip: "91911",
};

describe("buildSearchQuery", () => {
  test("folds ZIP and NY onto a bare street so geocoders can find Long Island", () => {
    expect(buildSearchQuery("782 Tanglewood rd", "11795")).toBe("782 Tanglewood rd, NY 11795");
  });

  test("does not duplicate an already-present ZIP", () => {
    expect(buildSearchQuery("782 Tanglewood rd 11795", "11795")).toBe("782 Tanglewood rd 11795");
  });
});

describe("rankSuggestions", () => {
  test("street name beats the same house number on a different avenue", () => {
    const ranked = rankSuggestions("782 Tanglewood rd", [troy, chula, tanglewood], "11795");
    expect(ranked[0]?.id).toBe("good");
    expect(ranked.map((s) => s.id)).not.toContain("ca");
  });

  test("Tanglewood tokens are distinctive", () => {
    expect(distinctiveStreetTokens("782 Tanglewood rd")).toEqual(["tanglewood"]);
  });

  test("wrong-street 782s score far below the real street", () => {
    const q = "782 Tanglewood rd";
    expect(scoreSuggestion(q, tanglewood, "11795")).toBeGreaterThan(scoreSuggestion(q, troy, "11795"));
    expect(scoreSuggestion(q, troy, "11795")).toBeLessThan(0);
  });
});
