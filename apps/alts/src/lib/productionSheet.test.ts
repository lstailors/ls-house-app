import { describe, expect, test } from "bun:test";
import {
  filterRows,
  formatShortDate,
  kpiCounts,
  overviewPayload,
  paginate,
  resolveStatusKey,
  serializeRow,
  trackingUrl,
} from "./productionSheet";

const base = {
  name: "YZ-1",
  order_no: "LST-26-323C",
  production_status: "In Production",
  customer_name: "Stern",
  mtmpro_order: "LST-122506-1",
  fabric_number: "F-12",
  qty_suit_coat: 1,
  qty_suit_pant: 1,
  date_placed: "2026-07-01",
  ship_date_planned: "2026-08-21",
  rush_days: 0,
  tracking_no: "1Z999AA10123456784",
  solid_fabric: true,
  fully_lined: true,
  half_canvas: false,
};

describe("production sheet mapping", () => {
  test("blank status with placed date is In Production; rush overlays", () => {
    expect(resolveStatusKey({ production_status: "", date_placed: "2026-07-01" })).toBe("prod");
    expect(resolveStatusKey({ production_status: "", date_placed: "" })).toBe("fab");
    expect(resolveStatusKey({ ...base, rush_days: 3 })).toBe("rush");
    expect(resolveStatusKey({ ...base, production_status: "Shipped", rush_days: 3 })).toBe("ship");
  });

  test("Fabric Not Received displays as Awaiting Fabric", () => {
    expect(serializeRow({ ...base, production_status: "Fabric Not Received" }).status_label).toBe(
      "Awaiting Fabric",
    );
  });

  test("search, filter, sort, paginate 25", () => {
    const rows = [
      { ...base, order_no: "LST-26-001C", customer_name: "Ada" },
      { ...base, order_no: "LST-26-342C", customer_name: "Stern", rush_days: 2 },
      { ...base, order_no: "LST-25-999C", production_status: "Shipped" },
    ];
    const filtered = filterRows(rows, "rush", "stern");
    expect(filtered.map((r) => r.order_no)).toEqual(["LST-26-342C"]);
    const newest = filterRows(rows, "all", "");
    expect(newest[0]?.order_no).toBe("LST-26-342C");
    const page = paginate(Array.from({ length: 30 }, (_, i) => i), 1);
    expect(page.rows).toHaveLength(25);
    expect(page.paging.pages).toBe(2);
  });

  test("UPS tracking and garment pills", () => {
    const row = serializeRow(base);
    expect(row.garments).toEqual([
      { qty: 1, label: "Coat" },
      { qty: 1, label: "Trouser" },
    ]);
    expect(trackingUrl(base.tracking_no)).toContain("ups.com/track");
    expect(row.tracking_short.startsWith("1Z99")).toBe(true);
    expect(formatShortDate("2026-08-21")).toBe("Aug 21");
  });

  test("kpis count rush by days, not visual key", () => {
    const kpis = kpiCounts([
      { ...base, rush_days: 2 },
      { ...base, production_status: "Shipped", rush_days: 1 },
      { ...base, production_status: "Fabric Not Received", rush_days: 0, date_placed: "" },
    ]);
    expect(kpis.rush).toBe(2);
    expect(kpis.ship).toBe(1);
    expect(kpis.fab).toBe(1);
  });

  test("week overview has rush queue and garment totals", () => {
    const overview = overviewPayload([base, { ...base, order_no: "LST-26-001C", rush_days: 4 }]);
    expect(overview.order_count).toBe(2);
    expect(overview.garment_total).toBe(4);
    expect(overview.rush_total).toBe(1);
    expect(overview.ship_weeks.length).toBeGreaterThan(0);
  });
});
