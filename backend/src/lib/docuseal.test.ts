import { describe, expect, test } from "bun:test";
import {
  docusealApiBase,
  docusealPublicBase,
  isDocusealProOnly,
  pickQcTemplate,
  templateSignerRole,
} from "./docuseal";

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

describe("DocuSeal OSS templates", () => {
  test("the Pro PDF endpoint error is recognized", () => {
    expect(
      isDocusealProOnly('{"status":404,"message":"This feature is available in Pro Edition: https://www.docuseal.com/pricing"}'),
    ).toBe(true);
    expect(isDocusealProOnly("template not found")).toBe(false);
  });

  test("picks a QC-named template, else the first", () => {
    const invoice = { id: 1, name: "Invoice" };
    const qc = { id: 2, name: "QC Sign-off", submitters: [{ name: "First Party" }] };
    expect(pickQcTemplate([invoice, qc])?.id).toBe(2);
    expect(pickQcTemplate([invoice], "1")?.id).toBe(1);
    expect(pickQcTemplate([invoice])?.id).toBe(1);
    expect(pickQcTemplate([])).toBeNull();
    expect(templateSignerRole(qc)).toBe("First Party");
    expect(templateSignerRole(invoice)).toBe("Inspector");
  });
});
