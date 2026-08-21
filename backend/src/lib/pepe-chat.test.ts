import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyContextPrefix,
  isPepeOwner,
  normalizeRavenMessages,
  oldestFirst,
  pepeChannelIdForEmail,
  pickPepeChannelId,
  unwrapGetMessages,
} from "./pepe-chat";

describe("pepeChannelIdForEmail hard-map", () => {
  test("returns live DMs for Carl and Gianna", () => {
    expect(pepeChannelIdForEmail("carl@lstailors.com")).toBe("lgrkaihbcd");
    expect(pepeChannelIdForEmail("gianna@lstailors.com")).toBe("lgs0shpjio");
    expect(pepeChannelIdForEmail("CARL@lstailors.com")).toBe("lgrkaihbcd");
    expect(pepeChannelIdForEmail("  Gianna@LSTailors.com  ")).toBe("lgs0shpjio");
  });

  test("returns null for anyone else — no sofia-live, no invented channel", () => {
    expect(pepeChannelIdForEmail("sofia@lstailors.com")).toBeNull();
    expect(pepeChannelIdForEmail("concierge@lstailors.com")).toBeNull();
    expect(pepeChannelIdForEmail("")).toBeNull();
    expect(pepeChannelIdForEmail(null)).toBeNull();
  });
});

describe("pickPepeChannelId is not the resolver", () => {
  test("intersection is empty in REST — do not use it for live DMs", () => {
    expect(pickPepeChannelId([], [], ["lgrkaihbcd", "lgs0shpjio"])).toBeNull();
    expect(pickPepeChannelId(["L&S Tailors-sofia-live"], ["dm-carl-pepe"], ["dm-carl-pepe"])).toBeNull();
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

  test("is_pepe only when owner is pepe@ — not is_bot_message", () => {
    expect(isPepeOwner("pepe@lstailors.com")).toBe(true);
    expect(isPepeOwner("PEPE@lstailors.com")).toBe(true);
    expect(isPepeOwner("gianna@lstailors.com", 1)).toBe(false);
    expect(isPepeOwner("concierge@lstailors.com", 1)).toBe(false);
    expect(isPepeOwner("sofia@lstailors.com", true)).toBe(false);
  });

  test("Sofia bot row is not styled as Pepe", () => {
    const msgs = normalizeRavenMessages(
      [
        {
          name: "sofia-old",
          text: "gold S",
          owner: "concierge@lstailors.com",
          creation: "2026-08-20 10:00:00",
          is_bot_message: 1,
        },
        {
          name: "pepe-1",
          text: "counter",
          owner: "pepe@lstailors.com",
          creation: "2026-08-20 10:01:00",
          is_bot_message: 0,
        },
      ],
      () => "",
    );
    expect(msgs[0]?.is_pepe).toBe(false);
    expect(msgs[0]?.is_bot_message).toBe(true);
    expect(msgs[1]?.is_pepe).toBe(true);
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
    expect(msgs[0]?.is_pepe).toBe(false);
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

  test("chat.ts uses the hard-map, not Channel Member intersection", () => {
    const chat = readFileSync(new URL("../routes/chat.ts", import.meta.url), "utf8");
    expect(chat).toContain("pepeChannelIdForEmail");
    expect(chat).not.toContain("Raven Channel Member");
    expect(chat).not.toContain("sofia-live");
    expect(chat).not.toContain("/api/raven");
  });
});
