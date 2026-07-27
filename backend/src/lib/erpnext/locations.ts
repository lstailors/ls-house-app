import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { DT } from "./doctypes";

export interface ErpLocationRow {
  name: string;
  location_code: string;
  location_name: string;
  short_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  twilio_number?: string | null;
  timezone?: string | null;
  erpnext_company?: string | null;
  erpnext_warehouse?: string | null;
  erp_ar_account?: string | null;
  erp_square_account?: string | null;
  square_location_id?: string | null;
  default_deposit_pct?: number | null;
  cal_com_calendar_id?: string | null;
  is_active?: number | null;
  sort_order?: number | null;
  opened_on?: string | null;
  creation?: string;
  modified?: string;
}

const FIELDS = [
  "name", "location_code", "location_name", "short_name", "address", "city", "state",
  "postal_code", "phone", "twilio_number", "timezone", "erpnext_company", "erpnext_warehouse",
  "erp_ar_account", "erp_square_account", "square_location_id", "default_deposit_pct",
  "cal_com_calendar_id", "is_active", "sort_order", "opened_on", "creation", "modified",
];

export function serializeLocation(loc: ErpLocationRow) {
  return {
    id: loc.location_code,
    code: loc.location_code,
    name: loc.location_name,
    shortName: loc.short_name ?? null,
    address: loc.address ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    postalCode: loc.postal_code ?? null,
    phone: loc.phone ?? null,
    twilioNumber: loc.twilio_number ?? null,
    timezone: loc.timezone ?? null,
    erpnextCompanyOrBranch: loc.erpnext_company ?? null,
    erpnextWarehouse: loc.erpnext_warehouse ?? null,
    erpArAccount: loc.erp_ar_account ?? null,
    erpSquareAccount: loc.erp_square_account ?? null,
    squareLocationId: loc.square_location_id ?? null,
    defaultDepositPct: loc.default_deposit_pct ?? 50,
    calComCalendarId: loc.cal_com_calendar_id ?? null,
    isActive: loc.is_active !== 0,
    sortOrder: loc.sort_order ?? 0,
    openedOn: loc.opened_on ?? null,
    createdAt: loc.creation ?? null,
    updatedAt: loc.modified ?? null,
  };
}

function bodyToErp(body: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    code: "location_code", name: "location_name", shortName: "short_name",
    address: "address", city: "city", state: "state", postalCode: "postal_code",
    phone: "phone", twilioNumber: "twilio_number", timezone: "timezone",
    erpnextCompanyOrBranch: "erpnext_company", erpnextWarehouse: "erpnext_warehouse",
    erpArAccount: "erp_ar_account", erpSquareAccount: "erp_square_account",
    squareLocationId: "square_location_id", defaultDepositPct: "default_deposit_pct",
    calComCalendarId: "cal_com_calendar_id", isActive: "is_active",
    sortOrder: "sort_order", openedOn: "opened_on",
  };
  const row: Record<string, unknown> = {};
  for (const [jsKey, erpKey] of Object.entries(map)) {
    if (body[jsKey] !== undefined) {
      row[erpKey] = jsKey === "isActive" ? (body[jsKey] ? 1 : 0) : body[jsKey];
    }
  }
  return row;
}

export async function listLocations(opts: { activeOnly?: boolean; code?: string } = {}): Promise<ErpLocationRow[]> {
  const filters: unknown[] = [];
  if (opts.activeOnly) filters.push(["is_active", "=", 1]);
  if (opts.code) filters.push(["location_code", "=", opts.code]);
  return erpList<ErpLocationRow>(DT.LOCATION, {
    filters,
    fields: FIELDS,
    order_by: "sort_order asc",
    limit: 100,
  });
}

export async function getLocationByCode(code: string): Promise<ErpLocationRow | null> {
  const rows = await listLocations({ code });
  return rows[0] ?? null;
}

export async function createLocation(body: Record<string, unknown>): Promise<ErpLocationRow> {
  const doc = bodyToErp(body);
  if (!doc.location_code || !doc.location_name) throw new Error("code and name are required");
  doc.is_active = doc.is_active ?? 1;
  const created = await erpCreate<ErpLocationRow>(DT.LOCATION, doc);
  if (!created) throw new Error("Failed to create location");
  return created;
}

export async function updateLocation(code: string, body: Record<string, unknown>): Promise<ErpLocationRow> {
  const existing = await getLocationByCode(code);
  if (!existing) throw new Error("Location not found");
  const updated = await erpUpdate<ErpLocationRow>(DT.LOCATION, existing.name, bodyToErp(body));
  if (!updated) throw new Error("Failed to update location");
  return updated;
}

export interface ErpCompanyRow {
  abbr?: string;
  default_currency?: string;
  country?: string;
  tax_id?: string;
  email?: string;
  website?: string;
  phone_no?: string;
  default_bank_account?: string;
  default_cash_account?: string;
  default_receivable_account?: string;
  default_income_account?: string;
  default_expense_account?: string;
  cost_center?: string;
  monthly_sales_target?: number;
  total_monthly_sales?: number;
  parent_company?: string;
}

export async function getLocationCompany(code: string): Promise<ErpCompanyRow | null> {
  const loc = await getLocationByCode(code);
  if (!loc?.erpnext_company) return null;
  return erpGet<ErpCompanyRow>("Company", loc.erpnext_company);
}
