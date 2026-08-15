import { afterEach, describe, expect, test } from "bun:test";
import { erpList, extractFieldNotPermitted, isAltsOrigin } from "./erp";

describe("extractFieldNotPermitted", () => {
  test("parses Frappe 417 field-not-permitted message", () => {
    expect(extractFieldNotPermitted("Field not permitted in query: billing_status")).toBe(
      "billing_status",
    );
  });

  test("parses wrapped _server_messages JSON", () => {
    const body = JSON.stringify({
      _server_messages: JSON.stringify([
        JSON.stringify({ message: "Field not permitted in query: lsh_delay_reason" }),
      ]),
    });
    expect(extractFieldNotPermitted(body)).toBe("lsh_delay_reason");
  });

  test("parses unknown column errors", () => {
    expect(extractFieldNotPermitted("Unknown column: 'notified_ready_at' in 'field list'")).toBe(
      "notified_ready_at",
    );
  });

  test("returns null when the body is unrelated", () => {
    expect(extractFieldNotPermitted("PermissionError: not permitted")).toBeNull();
  });
});

describe("isAltsOrigin", () => {
  test("keeps NYC and blank origins", () => {
    expect(isAltsOrigin("NYC")).toBe(true);
    expect(isAltsOrigin("")).toBe(true);
    expect(isAltsOrigin(null)).toBe(true);
    expect(isAltsOrigin("New York")).toBe(true);
  });

  test("drops Houston", () => {
    expect(isAltsOrigin("HOU")).toBe(false);
    expect(isAltsOrigin("Houston")).toBe(false);
  });
});

describe("erpList field retry", () => {
  const prev = {
    base: process.env.ERPNEXT_BASE_URL,
    key: process.env.ERPNEXT_API_KEY,
    secret: process.env.ERPNEXT_API_SECRET,
    fetch: globalThis.fetch,
  };

  afterEach(() => {
    process.env.ERPNEXT_BASE_URL = prev.base;
    process.env.ERPNEXT_API_KEY = prev.key;
    process.env.ERPNEXT_API_SECRET = prev.secret;
    globalThis.fetch = prev.fetch;
  });

  test("retries after dropping an unknown field and returns rows", async () => {
    process.env.ERPNEXT_BASE_URL = "https://erp.example.test";
    process.env.ERPNEXT_API_KEY = "k";
    process.env.ERPNEXT_API_SECRET = "s";

    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("billing_status")) {
        return new Response(
          JSON.stringify({
            _server_messages: JSON.stringify([
              JSON.stringify({ message: "Field not permitted in query: billing_status" }),
            ]),
          }),
          { status: 417, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [{ name: "ALT-NYC-2026-00001" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const rows = await erpList<{ name: string }>("Alteration Ticket", {
      fields: ["name", "billing_status"],
      throwOnError: true,
    });

    expect(rows).toEqual([{ name: "ALT-NYC-2026-00001" }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("billing_status");
    expect(calls[1]).not.toContain("billing_status");
  });

  test("sends limit_page_length=0 so Frappe returns the full list", async () => {
    process.env.ERPNEXT_BASE_URL = "https://erp.example.test";
    process.env.ERPNEXT_API_KEY = "k";
    process.env.ERPNEXT_API_SECRET = "s";

    let seen = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen = String(input);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await erpList("Alteration Ticket", { fields: ["name"], limit: 0, throwOnError: true });
    expect(seen).toContain("limit_page_length=0");
  });

  test("throws when credentials are missing and throwOnError is set", async () => {
    delete process.env.ERPNEXT_BASE_URL;
    delete process.env.ERPNEXT_API_KEY;
    delete process.env.ERPNEXT_API_SECRET;

    await expect(
      erpList("Alteration Ticket", { fields: ["name"], throwOnError: true }),
    ).rejects.toThrow("ERPNext credentials missing");
  });
});
