import { describe, expect, test } from "bun:test";
import {
  completionPatches,
  destinationFor,
  parseFloorScan,
  presentTicket,
  rackPatch,
} from "./floor";

const ticket = {
  name: "ALT-NYC-2026-00232",
  customer_name: "Edward Sexton",
  due_date: "2026-09-03",
  due_time: "16:00:00",
  workflow_state: "Received",
  garments: [
    { name: "row-g1", garment_id: "G1", garment_type: "Trouser", current_location: "Work In Progress - LSTNY", garment_status: "Received" },
    { name: "row-g2", garment_id: "G2", garment_type: "Jacket", current_location: "Work In Progress - LSTNY", garment_status: "Ready" },
  ],
  lines: [
    { name: "line-1", garment_ref: "G1", description: "Taper legs", line_status: "Pending" },
    { name: "line-2", garment_ref: "G2", description: "Shorten hem", line_status: "Done" },
  ],
};

describe("shop-floor scan contract", () => {
  test("accepts garment URLs, ticket names, invoice names and token URLs", () => {
    expect(parseFloorScan("https://alts.lstailors.com/g/ALT-NYC-2026-00232/G2")).toEqual({ kind: "garment", ticket: "ALT-NYC-2026-00232", garment: "G2" });
    expect(parseFloorScan("ALT-NYC-2026-00232")).toEqual({ kind: "ticket", ticket: "ALT-NYC-2026-00232" });
    expect(parseFloorScan("LSTNY-SINV-2026-01616")).toEqual({ kind: "invoice", invoice: "LSTNY-SINV-2026-01616" });
    expect(parseFloorScan("https://floor.lstailors.com/?token=abc123")).toEqual({ kind: "token", token: "abc123" });
  });

  test("does not accept ambiguous G1 by itself", () => {
    expect(() => parseFloorScan("G1")).toThrow("ticket");
  });
});

describe("shop-floor ERP projections and writes", () => {
  test("stacks ticket garments with their own work lines", () => {
    const shown = presentTicket(ticket as any);
    expect(shown.garments[0]?.work).toEqual(["Taper legs"]);
    expect(shown.garments[1]?.work).toEqual(["Shorten hem"]);
    expect(shown.allDone).toBe(false);
  });

  test("maps the four locked transfer destinations", () => {
    expect(destinationFor("Stella").warehouse).toBe("Home Tailor One - LSTNY");
    expect(destinationFor("Hugo").warehouse).toBe("Home Tailor Two - LSTNY");
    expect(destinationFor("Munro").warehouse).toBe("Munro - LSTNY");
    expect(destinationFor("Floor").warehouse).toBe("Work In Progress - LSTNY");
  });

  test("completion writes Ready, tailor, minutes and note to matching rows", () => {
    const patches = completionPatches(ticket as any, "G1", "HR-EMP-00015", 75, "Pressed clean", "2026-08-28 12:00:00");
    expect(patches.garment).toEqual(expect.objectContaining({ garment_status: "Ready", completed_by: "HR-EMP-00015", actual_minutes: 75 }));
    expect(patches.lines).toEqual([{ name: "line-1", patch: { tailor: "HR-EMP-00015", line_status: "Done", actual_minutes: 75, line_notes: "Pressed clean" } }]);
  });

  test("rack transition uses Ready and explicit rack fields", () => {
    expect(rackPatch("12", "NYC Showroom - LSTNY")).toEqual({ workflow_state: "Ready", lsh_rack_number: "12", lsh_rack_location: "NYC Showroom - LSTNY" });
  });
});
