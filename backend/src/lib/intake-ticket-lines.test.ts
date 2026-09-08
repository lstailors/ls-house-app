import { describe, expect, test } from "bun:test";
import { buildTicketLines } from "./intake-ticket-lines";

describe("buildTicketLines", () => {
  test("adds a required zero-dollar line for a sell-only ticket", () => {
    const lines = buildTicketLines(
      [
        {
          ref: "G1",
          lines: [],
        },
      ],
      "Custom charge / other · Pink · sz One · ETA 1 Week",
    );

    expect(lines).toEqual([
      {
        garment_ref: "G1",
        preset: null,
        description: "Custom charge / other · Pink · sz One · ETA 1 Week",
        price: 0,
        estimated_minutes: 15,
        line_notes: "Shell line for sell/MTM/wholesale charge",
        client_line_key: "sell-shell",
      },
    ]);
  });
});
