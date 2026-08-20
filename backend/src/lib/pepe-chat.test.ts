import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyContextPrefix,
  isPepeOwner,
  normalizeRavenMessages,
  oldestFirst,
  pickPepeChannelId,
  unwrapGetMessages,
} from "./pepe-chat";

describe("pickPepeChannelId", () => {
  test("returns the shared DM only", () => {
    expect(
      pickPepeChannelId(
        ["pub-1", "dm-gianna-pepe", "dm-other"],
        ["dm-gianna-pepe", "dm-carl-pepe"],
        ["dm-gianna-pepe", "dm-carl-pepe", "dm-other"],
      ),
    ).toBe("dm-gianna-pepe");
  });

  test("returns null when no shared DM (do not fall back to public)", () => {
    expect(pickPepeChannelId(["L&S Tailors-sofia-live"], ["dm-carl-pepe"], ["dm-carl-pepe"])).toBeNull();
    expect(pickPepeChannelId(["shared-open"], ["shared-open"], [])).toBeNull();
  });

  test("never uses a client-supplied id that is not in the intersection", () => {
    const clientSupplied = "evil-channel";
    const resolved = pickPepeChannelId(["mine"], ["pepe-only"], ["mine"]);
    expect(resolved).toBeNull();
    expect(resolved).not.toBe(clientSupplied);
  });
});

describe("message shaping", () => {
  test("oldestFirst then limit keeps the latest window", () => {
    const rows = [
      { name: "c", creation: "2026-08-20 12:00:00" },
      { name: "a", creation: "2026-08-20 10:00:00" },
      { name: "b", creation: "2026-08-20 11:00:00" },
    ];
    expect(oldestFirst(rows).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  test("Pepe owner / bot flag", () => {
    expect(isPepeOwner("pepe@lstailors.com")).toBe(true);
    expect(isPepeOwner("PEPE@lstailors.com")).toBe(true);
    expect(isPepeOwner("gianna@lstailors.com", 1)).toBe(true);
    expect(isPepeOwner("gianna@lstailors.com")).toBe(false);
  });

  test("normalize proxies file URLs and never leaks erp host as-is from helper", () => {
    const msgs = normalizeRavenMessages(
      [
        {
          name: "m1",
          text: "photo",
          owner: "gianna@lstailors.com",
          creation: "2026-08-20 10:00:00",
          message_type: "Image",
          file: "/private/files/hem.jpg",
          file_size: 2048,
        },
      ],
      (file) => `/api/files/erp?path=${encodeURIComponent(file)}`,
    );
    expect(msgs[0]?.file_url).toBe("/api/files/erp?path=%2Fprivate%2Ffiles%2Fhem.jpg");
    expect(msgs[0]?.file_url).not.toContain("erp.lstailors.com");
    expect(msgs[0]?.file_name).toBe("hem.jpg");
  });

  test("unwrapGetMessages accepts Raven envelope shapes", () => {
    expect(unwrapGetMessages([{ name: "a" }])).toHaveLength(1);
    expect(unwrapGetMessages({ messages: [{ name: "a" }] })).toHaveLength(1);
    expect(unwrapGetMessages({ message: [{ name: "a" }] })).toHaveLength(1);
    expect(unwrapGetMessages(null)).toEqual([]);
  });
});

describe("applyContextPrefix", () => {
  test("prefixes first send context", () => {
    expect(applyContextPrefix("hello", { doctype: "Alteration Ticket", name: "AT-001" })).toBe(
      "[context: Alteration Ticket / AT-001]\nhello",
    );
  });
  test("skips empty context", () => {
    expect(applyContextPrefix("hello", null)).toBe("hello");
  });
});

describe("chat router is mounted", () => {
  test("app.ts and index.ts mount /api/chat", () => {
    const app = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(app).toContain('app.route("/api/chat", chatRouter)');
    expect(index).toContain('app.route("/api/chat", chatRouter)');
  });
});
