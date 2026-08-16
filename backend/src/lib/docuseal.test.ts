import { describe, expect, test } from "bun:test";
import {
  docusealApiBase,
  docusealPublicBase,
  isDocusealProOnly,
  isUnknownFieldError,
  parseDocusealWebhook,
  pickKnownFields,
  pickQcTemplate,
  qcDocusealFields,
  templateFieldNames,
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

  test("form.completed webhook finds the QC ticket and signed PDF", () => {
    const parsed = parseDocusealWebhook({
      event_type: "form.completed",
      data: {
        id: 1,
        submission_id: 12,
        status: "completed",
        external_id: "LSH-QC-2026-00001",
        documents: [{ url: "https://docuseal.lstailors.com/blobs/signed.pdf" }],
        submission: { id: 12, combined_document_url: "https://docuseal.lstailors.com/blobs/combined.pdf" },
      },
    });
    expect(parsed.completed).toBe(true);
    expect(parsed.ids).toContain("12");
    expect(parsed.ids).toContain("1");
    expect(parsed.inspectionName).toBe("LSH-QC-2026-00001");
    expect(parsed.signedUrl).toContain("signed.pdf");
    expect(parseDocusealWebhook({ event_type: "form.viewed", data: { id: 1 } }).completed).toBe(false);
  });

  test("Unknown field: Customer is recognized", () => {
    expect(isUnknownFieldError('{"error":"Unknown field: Customer"}')).toBe(true);
    expect(isUnknownFieldError("template not found")).toBe(false);
  });

  test("a Signature-only template sends no fill-in fields", () => {
    const known = templateFieldNames({
      id: 1,
      fields: [{ name: "Signature", type: "signature" }],
    });
    expect(known).toEqual([]);
    const wanted = qcDocusealFields({ customerName: "Ada West", result: "Pass" });
    expect(wanted.some((f) => f.name === "Customer")).toBe(true);
    expect(pickKnownFields(wanted, known)).toEqual([]);
  });

  test("only fields that exist on the template are sent", () => {
    const wanted = qcDocusealFields({ customerName: "Ada West", result: "Pass", notes: "Hem" });
    const picked = pickKnownFields(wanted, ["customer", "Notes"]);
    expect(picked.map((f) => f.name)).toEqual(["Customer", "Notes"]);
    expect(picked.find((f) => f.name === "Customer")?.default_value).toBe("Ada West");
  });
});

describe("DocuSeal submit never invents template fields", () => {
  test("createQcSignatureSubmission does not POST Customer / Order fields", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./docuseal.ts", import.meta.url), "utf8");
    expect(src).toContain("Never send fill-in names");
    expect(src).not.toContain("pickKnownFields(opts.fields");
    expect(src).toContain("isUnknownFieldError(err)");
  });
});
