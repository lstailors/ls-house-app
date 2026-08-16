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
    expect(garment).toContain("right-[340px] w-[min(720px,calc(100vw-360px))]");
    const picker = readFileSync(
      new URL("../components/intake/TaskSubitemPicker.tsx", import.meta.url),
      "utf8",
    );
    expect(picker).toContain("leavesForZone");
    expect(picker).toContain("every quote line");
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
    expect(app).toContain("ProgressBoard");
    expect(app).toContain('path="/progress"');
    expect(app).toContain("QcGlass");
    expect(app).toContain('path="/qc"');
    expect(app).toContain("QcInspection");
    expect(app).toContain('path="/qc/:id"');
    expect(app).toContain("AltsSettings");
    expect(app).toContain('path="/settings"');
    const home = readFileSync(new URL("../pages/HomeTiles.tsx", import.meta.url), "utf8");
    expect(home).toContain('nav("/settings")');
    expect(home).not.toMatch(/onClick=\{logout\}/);
    const settings = readFileSync(new URL("../pages/AltsSettings.tsx", import.meta.url), "utf8");
    expect(settings).toContain("/api/qc/settings");
    expect(settings).toContain("https://docuseal.lstailors.com/settings/api");
    expect(settings).toContain("https://docuseal.lstailors.com/templates");
    expect(settings).toContain("New Template");
    expect(settings).toContain("you will not be asked again");
    expect(settings).toContain("rememberDocusealKey");
    expect(settings).toContain("/api/webhooks/docuseal");
    expect(settings).not.toContain("localStorage");
    expect(settings).toContain("signOut");
    expect(settings).toContain("clearClientSession");
    const login = readFileSync(new URL("../../../../packages/auth/src/Login.tsx", import.meta.url), "utf8");
    expect(login).toContain("justLoggedOut");
    expect(login).toContain("if (me && !justLoggedOut())");
    const guard = readFileSync(new URL("../../../../packages/auth/src/RoleGuard.tsx", import.meta.url), "utf8");
    expect(guard).toContain("justLoggedOut()");
    const shell = readFileSync(new URL("../components/AltsShell.tsx", import.meta.url), "utf8");
    expect(shell).toContain('to="/settings"');
    expect(shell).not.toMatch(/onClick=\{logout\}/);
    const qc = readFileSync(new URL("../pages/QcGlass.tsx", import.meta.url), "utf8");
    expect(qc).toContain("nav(`/qc/${encodeURIComponent(target)}`)");
    expect(qc).not.toContain("OrderStatusChips");
    expect(qc).not.toContain("MtmStatusRail");
    expect(qc).not.toContain("Live order status");
    expect(qc).not.toContain("/api/qc/orders");
    expect(qc).not.toContain("api.post");
    expect(qc).toContain('["waiting", "Waiting"]');
    expect(qc).toContain('["passed", "Passed"]');
    expect(qc).toContain('["failed", "Failed"]');
    expect(qc).not.toContain('["open", "Open"]');
    expect(qc).toContain("min-h-[56px]");
    expect(qc).not.toContain("/api/qc/rates");
    const item = readFileSync(new URL("../pages/QcInspection.tsx", import.meta.url), "utf8");
    expect(item).not.toContain("MtmStatusRail");
    expect(item).not.toContain("Live order status");
    expect(item).not.toContain("/api/qc/orders/");
    expect(item).toContain("Sign with DocuSeal");
    expect(item).toContain("Sign and submit");
    expect(item).toContain("webhook");
    expect(item).toContain("Awaiting Fitting");
    expect(item).toContain("Open DocuSeal");
    expect(item).toContain('target="_blank"');
    expect(item).not.toContain("qc-docuseal-frame");
    expect(item).not.toContain("min-h-[420px]");
    expect(item).toContain("blankQcChecks");
    expect(item).toContain("isQcInspectionName");
    expect(item).toContain("Store arrival");
    expect(item).not.toContain("setTimeout(() => {\n      save.mutate({ checks, notes, failReason })");
    const drawer = readFileSync(new URL("../components/intake/GarmentOptionsDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("/qc");
    expect(app).toContain("NotFound");
    expect(app).toContain('path="/reports/:tab?"');
    expect(app).not.toContain('Navigate to="/"');
    expect(home).not.toContain("app.lstailors.com/owner");
    expect(home).not.toContain("Store QC · makes only");
    const reports = readFileSync(new URL("../pages/Reports.tsx", import.meta.url), "utf8");
    expect(reports).toContain('["hou", "Houston"]');
    expect(reports).toContain('["qc", "QC rates"]');
    expect(reports).toContain('params.get("kiosk") === "1"');
    const search = readFileSync(new URL("../components/UniversalSearch.tsx", import.meta.url), "utf8");
    expect(search).toContain('!pathname.startsWith("/reports")');
    const kind = readFileSync(new URL("../pages/TicketKind.tsx", import.meta.url), "utf8");
    expect(kind).toContain("useState<Kind | null>(null)");
    expect(kind).not.toContain("Opening client & cart");
    const customers = readFileSync(new URL("../pages/Customers.tsx", import.meta.url), "utf8");
    expect(customers).not.toContain("VIP (page)");
    expect(customers).not.toContain("Casa (page)");
    const chips = readFileSync(new URL("../components/OrderStatusChips.tsx", import.meta.url), "utf8");
    expect(chips).toContain("flex-wrap");
    expect(chips).toContain("shrink-0");
    expect(app).toContain("TimedSpinner");
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

  test("sell catalog puts MTM on the floor for walk-in invoices", () => {
    const catalog = readFileSync(
      new URL("../components/intake/SellItemCatalog.tsx", import.meta.url),
      "utf8",
    );
    expect(catalog).toContain('{ id: "mtm", label: "MTM" }');
    expect(catalog).toContain("Stock, MTM, and special-order");
    expect(catalog).toContain("MTM-SUIT");
  });
});
