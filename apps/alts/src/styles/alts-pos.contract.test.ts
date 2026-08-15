import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./alts-pos.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("Alts touch target contract", () => {
  test("the shared login is inside the Alts interaction-floor scope", () => {
    expect(app).toContain(
      '<Route path="/login" element={<div className="alts-root"><Login /></div>} />',
    );
  });
  test("all native and ARIA controls have a 44px height floor", () => {
    expect(css).toContain(
      ".alts-root :where(\n  button,\n  [role=\"button\"],\n  input:not([type=\"hidden\"]):not([type=\"checkbox\"]):not([type=\"radio\"]),\n  select,\n  textarea\n)",
    );
    expect(css).toContain("min-height: 44px");
  });

  test("compact icon controls have a 44px width floor", () => {
    expect(css).toContain(
      '.alts-root :where(button, [role="button"], a[href])',
    );
    expect(css).toContain("min-width: 44px");
  });

  test("all links expose a real 44px hit box", () => {
    expect(css).toMatch(
      /\.alts-root a\[href\]\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s,
    );
    expect(css).toMatch(
      /\.alts-root a\[href\][^{]*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;/s,
    );
  });

  test("wrapped checkbox, radio, and file controls use a 44px label target", () => {
    expect(css).toMatch(
      /\.alts-root label:has\(\s*input:where\(\[type="checkbox"\], \[type="radio"\], \[type="file"\]\)\s*\)\s*\{[^}]*min-height:\s*44px;/s,
    );
  });
});

describe("iPhone scale contract", () => {
  test("the document asks Safari to fit the device width", () => {
    expect(html).toContain('width=device-width');
    expect(html).toContain("viewport-fit=cover");
  });

  test("the page does not leak sideways or inflate text", () => {
    expect(css).toContain("-webkit-text-size-adjust: 100%");
    expect(css).toContain("overflow-x: hidden");
  });

  test("appointments live on Alts, not a jump to the house app", () => {
    expect(app).toContain("AppointmentsGlass");
    expect(app).toContain('path="/appointments"');
  });
});
