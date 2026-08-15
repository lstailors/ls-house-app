import { describe, expect, test } from "bun:test";
import { docusealApiBase, docusealPublicBase } from "./docuseal";

describe("docuseal URLs", () => {
  test("self-hosted host gets /api", () => {
    expect(docusealApiBase("https://docuseal.lstailors.com")).toBe("https://docuseal.lstailors.com/api");
    expect(docusealApiBase("https://docuseal.lstailors.com/")).toBe("https://docuseal.lstailors.com/api");
  });

  test("does not double /api", () => {
    expect(docusealApiBase("https://docuseal.lstailors.com/api")).toBe("https://docuseal.lstailors.com/api");
  });

  test("cloud API host stays as-is", () => {
    expect(docusealApiBase("https://api.docuseal.com")).toBe("https://api.docuseal.com");
  });

  test("public base drops /api for the embed page", () => {
    expect(docusealPublicBase("https://docuseal.lstailors.com/api")).toBe("https://docuseal.lstailors.com");
  });
});
