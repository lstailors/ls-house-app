import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const rows: Record<string, any[]> = {};

mock.module("../lib/scope", () => ({
  getAuthedUser: async () => ({
    id: "a@lstailors.com",
    email: "a@lstailors.com",
    name: "A",
    role: "salesperson",
    locationId: null,
    locationCode: null,
    canViewAllLocations: true,
  }),
}));

mock.module("../lib/erp", () => ({
  erpList: async (doctype: string) => rows[doctype] ?? [],
  erpGet: async () => null,
  erpCreate: async () => null,
  erpUpdate: async () => null,
}));

let searchRouter: typeof import("./search").searchRouter;

beforeAll(async () => {
  ({ searchRouter } = await import("./search"));
});

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  delete process.env.ERPNEXT_BASE_URL;
  delete process.env.ERPNEXT_API_KEY;
  delete process.env.ERPNEXT_API_SECRET;
});

async function search(q: string) {
  const res = await searchRouter.request(`/?q=${encodeURIComponent(q)}`);
  const body = (await res.json()) as { data?: { results?: Array<Record<string, unknown>>; query?: string } };
  return { status: res.status, body };
}

describe("GET /api/search missing strings", () => {
  test("does not throw when one of several hits has no id or title", async () => {
    rows["Alteration Ticket"] = [
      { name: "ALT-1", customer_name: "Ada", workflow_state: "Open" },
      { customer_name: "Ghost" },
      { name: null, customer_name: null },
    ];

    const { status, body } = await search("ada");

    expect(status).toBe(200);
    expect(body.data?.query).toBe("ada");
    const ids = (body.data?.results ?? []).map((hit) => hit.id);
    expect(ids).toContain("ALT-1");
    expect(body.data?.results?.length).toBe(3);
  });

  test("does not throw when a fabric title is missing beside another hit", async () => {
    rows["LSH Fabric Pricing"] = [{ name: "FAB-9", mill: "Holland" }];
    rows["Alteration Ticket"] = [{ name: "ALT-1", customer_name: "Ada", workflow_state: "Open" }];

    const { status, body } = await search("holland");

    expect(status).toBe(200);
    const types = (body.data?.results ?? []).map((hit) => hit.type);
    expect(types).toContain("fabric");
    expect(types).toContain("alteration");
  });

  test("keeps exact id matches ahead of other hits", async () => {
    rows["Alteration Ticket"] = [
      { name: "OTHER", customer_name: "Ada", workflow_state: "Open" },
      { name: "ALT-100", customer_name: "Bea", workflow_state: "Open" },
    ];

    const { status, body } = await search("ALT-100");

    expect(status).toBe(200);
    expect(body.data?.results?.[0]?.id).toBe("ALT-100");
    expect(body.data?.results?.map((hit) => hit.id)).toEqual(["ALT-100", "OTHER"]);
  });
});
