import { describe, expect, test } from "bun:test";
import {
  hasHouseAndStreetMatch,
  rankSuggestions,
  significantTokens,
  suggestionMatchesQuery,
} from "./placesSearch";

describe("placesSearch", () => {
  test("treats rd as road and ignores house numbers", () => {
    expect(significantTokens("782 Tanglewood rd")).toEqual(["tanglewood", "road"]);
  });

  test("drops Photon house-number misses that ignore the street", () => {
    const query = "782 Tanglewood rd";
    expect(
      suggestionMatchesQuery(query, {
        id: "1",
        label: "782 3rd Avenue, Troy, NY, 12182",
        street: "782 3rd Avenue",
        city: "Troy",
        state: "NY",
        zip: "12182",
      }),
    ).toBe(false);
    expect(
      suggestionMatchesQuery(query, {
        id: "2",
        label: "782 Tanglewood Road, Westbury, NY, 11590",
        street: "782 Tanglewood Road",
        city: "Westbury",
        state: "NY",
        zip: "11590",
      }),
    ).toBe(true);
  });

  test("keeps number-only queries so early typing still works", () => {
    expect(significantTokens("782")).toEqual([]);
    expect(
      suggestionMatchesQuery("782", {
        id: "1",
        label: "782 3rd Avenue, Troy, NY, 12182",
        street: "782 3rd Avenue",
        city: "Troy",
        state: "NY",
        zip: "12182",
      }),
    ).toBe(true);
  });

  test("ranks a matching NY street above leftover noise", () => {
    const ranked = rankSuggestions("782 Tanglewood rd", [
      {
        id: "ca",
        label: "782 3rd Street, Imperial Beach, California, 91932",
        street: "782 3rd Street",
        city: "Imperial Beach",
        state: "CA",
        zip: "91932",
      },
      {
        id: "ny",
        label: "782 Tanglewood Road, Westbury, NY, 11590",
        street: "782 Tanglewood Road",
        city: "Westbury",
        state: "NY",
        zip: "11590",
      },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["ny"]);
  });

  test("knows when Photon only matched the house number", () => {
    expect(
      hasHouseAndStreetMatch("782 Tanglewood rd", [
        {
          id: "1",
          label: "782 3rd Avenue, Troy, NY, 12182",
          street: "782 3rd Avenue",
          city: "Troy",
          state: "NY",
          zip: "12182",
        },
      ]),
    ).toBe(false);
  });
});
