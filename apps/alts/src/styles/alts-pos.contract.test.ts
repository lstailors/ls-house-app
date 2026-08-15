import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const css = readFileSync(new URL("./alts-pos.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const pub = new URL("../../public/", import.meta.url);

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

  test("intake options drawers never use translate-x-full over the cart", () => {
    expect(css).toContain("calc(100% + 340px)");
    expect(css).toMatch(/\.lux-intake-drawer\.is-out\s*\{[^}]*translateX\(calc\(100% \+ 340px\)\)/s);
    expect(css).toMatch(/\.lux-intake-drawer\.is-in\s*\{[^}]*translateX\(0\)/s);
    const garment = readFileSync(
      new URL("../components/intake/GarmentOptionsDrawer.tsx", import.meta.url),
      "utf8",
    );
    const sell = readFileSync(
      new URL("../components/intake/SellItemDrawer.tsx", import.meta.url),
      "utf8",
    );
    const cart = readFileSync(
      new URL("../components/intake/TicketCartSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(garment).toContain('entered ? "is-in" : "is-out pointer-events-none"');
    expect(garment).not.toContain("translate-x-full");
    expect(sell).toContain('entered ? "is-in" : "is-out pointer-events-none"');
    expect(sell).not.toContain("translate-x-full");
    expect(cart).toContain('variant={desk ? "drawer" : "sheet"}');
  });

  test("the scan camera stays a corner circle, not a sideways rail", () => {
    expect(css).toMatch(/\.scan-fab\s*\{[^}]*width:\s*56px\s*!important/s);
    expect(css).toMatch(/\.scan-fab\s*\{[^}]*height:\s*56px\s*!important/s);
    expect(css).toMatch(/\.scan-fab\s*\{[^}]*max-height:\s*56px\s*!important/s);
    const fab = readFileSync(new URL("../components/ScanFab.tsx", import.meta.url), "utf8");
    expect(fab).not.toContain("lux-page-enter");
  });

  test("the L&S seal is the tab icon and the iPhone home-screen icon", () => {
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-title');
    expect(existsSync(new URL("apple-touch-icon.png", pub))).toBe(true);
    expect(existsSync(new URL("favicon.ico", pub))).toBe(true);
    expect(existsSync(new URL("icon-512.png", pub))).toBe(true);
    expect(existsSync(new URL("ls-logo-crest.png", pub))).toBe(true);
  });

  test("the page does not leak sideways or inflate text", () => {
    expect(css).toContain("-webkit-text-size-adjust: 100%");
    expect(css).toContain("overflow-x: hidden");
  });

  test("appointments live on Alts, not a jump to the house app", () => {
    expect(app).toContain("AppointmentsGlass");
    expect(app).toContain('path="/appointments"');
  });

  test("house pages live on Alts for phone use", () => {
    expect(app).toContain("TasksGlass");
    expect(app).toContain('path="/tasks"');
    expect(app).toContain("MessagesGlass");
    expect(app).toContain('path="/messages"');
    expect(app).toContain("HouseFind");
    expect(app).toContain('path="/house"');
    expect(app).toContain("QcGlass");
    expect(app).toContain('path="/qc"');
    expect(app).toContain("QcInspection");
    expect(app).toContain('path="/qc/:id"');
  });

  test("home never locks to one viewport — iPhone landscape must scroll", () => {
    expect(css).toContain("height: auto !important");
    expect(css).toContain("overflow-y: visible !important");
    expect(css).not.toMatch(/\.home-040-grid\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).not.toContain("grid-template-rows: repeat(2");
  });

  test("short-height chrome compress stays off iPhone landscape", () => {
    expect(css).toContain("@media (min-width: 1200px) and (min-height: 700px) and (max-height: 900px)");
    expect(css).not.toMatch(/@media \(min-width:\s*900px\) and \(max-height:\s*900px\)/);
  });
});
