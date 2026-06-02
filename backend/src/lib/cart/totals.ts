// Alterations are $0 tax. Use totalsFromErpInvoice() to mirror ERPNext invoice.
const TAX_EXEMPT_ITEM_GROUPS = new Set(["Alteration Services"]);
export interface CartLine { itemCode: string; itemGroup: string; rate: number; qty: number; }

export function computeCartTotals(lines: CartLine[], taxRate = 0.08875) {
  let taxableBase = 0, exemptBase = 0;
  for (const l of lines) {
    const amount = l.rate * l.qty;
    if (TAX_EXEMPT_ITEM_GROUPS.has(l.itemGroup)) exemptBase += amount; else taxableBase += amount;
  }
  const subtotal = taxableBase + exemptBase;
  const tax = round2(taxableBase * taxRate);
  return { subtotal: round2(subtotal), tax, total: round2(subtotal + tax), taxableBase, exemptBase };
}

export async function totalsFromErpInvoice(invoiceName: string) {
  const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
  const res = await fetch(
    `${ERP_URL}/api/resource/Sales Invoice/${encodeURIComponent(invoiceName)}?fields=["net_total","total_taxes_and_charges","grand_total"]`,
    { headers: { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: "application/json" } }
  );
  const { data } = await res.json();
  return { subtotal: data.net_total, tax: data.total_taxes_and_charges, total: data.grand_total };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
