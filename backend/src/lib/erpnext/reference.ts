import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { DT } from "./doctypes";

// ─── Fabrics ────────────────────────────────────────────────────────────────

export async function listFabrics(activeOnly = true) {
  const filters: unknown[] = activeOnly ? [["is_active", "=", 1]] : [];
  return erpList<any>(DT.FABRIC_PRICING, {
    filters,
    fields: ["name", "fabric_name", "mill", "composition", "weight", "season", "tier", "price", "is_active", "creation", "modified"],
    order_by: "fabric_name asc",
    limit: 500,
  });
}

export function serializeFabric(row: any) {
  return {
    id: row.name,
    fabricName: row.fabric_name,
    mill: row.mill ?? null,
    composition: row.composition ?? null,
    weight: row.weight ?? null,
    season: row.season ?? null,
    tier: row.tier ?? null,
    price: Number(row.price ?? 0),
    isActive: row.is_active !== 0,
    createdAt: row.creation,
    updatedAt: row.modified,
  };
}

export async function createFabric(body: any) {
  return erpCreate(DT.FABRIC_PRICING, {
    fabric_name: body.fabricName,
    mill: body.mill ?? null,
    composition: body.composition ?? null,
    weight: body.weight ?? null,
    season: body.season ?? null,
    tier: body.tier ?? null,
    price: body.price,
    is_active: 1,
  });
}

export async function updateFabric(id: string, body: any) {
  const mapped: Record<string, unknown> = {};
  if (body.fabricName !== undefined) mapped.fabric_name = body.fabricName;
  if (body.mill !== undefined) mapped.mill = body.mill;
  if (body.composition !== undefined) mapped.composition = body.composition;
  if (body.weight !== undefined) mapped.weight = body.weight;
  if (body.season !== undefined) mapped.season = body.season;
  if (body.tier !== undefined) mapped.tier = body.tier;
  if (body.price !== undefined) mapped.price = body.price;
  if (body.isActive !== undefined) mapped.is_active = body.isActive ? 1 : 0;
  return erpUpdate(DT.FABRIC_PRICING, id, mapped);
}

// ─── Styles ───────────────────────────────────────────────────────────────

/** House style catalog used when LSH Style Library is empty (live ERP has 0 rows). */
const DEFAULT_STYLE_CATALOG: Array<{ name: string; category: string; style_name: string; description: string }> = [
  // Jacket / suit
  { name: "STYLE-LAPEL-NOTCH", category: "lapel", style_name: "Notch", description: "Classic notch lapel" },
  { name: "STYLE-LAPEL-PEAK", category: "lapel", style_name: "Peak", description: "Peak lapel (+$80)" },
  { name: "STYLE-LAPEL-SHAWL", category: "lapel", style_name: "Shawl", description: "Shawl collar (+$140)" },
  { name: "STYLE-VENT-NONE", category: "vent", style_name: "No Vent", description: "Clean back" },
  { name: "STYLE-VENT-SINGLE", category: "vent", style_name: "Single Vent", description: "Center vent" },
  { name: "STYLE-VENT-DOUBLE", category: "vent", style_name: "Double Vent", description: "Side vents (+$60)" },
  { name: "STYLE-POCKET-FLAP", category: "pocket", style_name: "Flap", description: "Flap pockets" },
  { name: "STYLE-POCKET-JETTED", category: "pocket", style_name: "Jetted", description: "Jetted pockets" },
  { name: "STYLE-POCKET-PATCH", category: "pocket", style_name: "Patch", description: "Patch pockets" },
  { name: "STYLE-LINING-FULL", category: "lining", style_name: "Full", description: "Full lining" },
  { name: "STYLE-LINING-HALF", category: "lining", style_name: "Half", description: "Half lined" },
  { name: "STYLE-LINING-SILK", category: "lining", style_name: "Silk Twill", description: "Silk twill lining (+$280)" },
  { name: "STYLE-BTN-HORN", category: "button", style_name: "Horn", description: "Horn buttons" },
  { name: "STYLE-BTN-MOP", category: "button", style_name: "Mother of Pearl", description: "MOP buttons (+$180)" },
  { name: "STYLE-CANVAS-FULL", category: "construction", style_name: "Full-Canvas", description: "Full canvas" },
  { name: "STYLE-CANVAS-HALF", category: "construction", style_name: "Half-Canvas", description: "Half canvas (+$350)" },
  // Shirt
  { name: "STYLE-COLLAR-POINT", category: "collar", style_name: "Point", description: "Point collar" },
  { name: "STYLE-COLLAR-SPREAD", category: "collar", style_name: "Spread", description: "Spread collar" },
  { name: "STYLE-COLLAR-BUTTON", category: "collar", style_name: "Button-Down", description: "Button-down collar" },
  { name: "STYLE-CUFF-BARREL", category: "cuff", style_name: "Barrel", description: "Barrel cuff" },
  { name: "STYLE-CUFF-FRENCH", category: "cuff", style_name: "French", description: "French cuff (+$60)" },
  { name: "STYLE-PLACKET-STANDARD", category: "placket", style_name: "Standard", description: "Standard placket" },
  { name: "STYLE-PLACKET-HIDDEN", category: "placket", style_name: "Hidden", description: "Hidden placket" },
];

export async function listStyles(activeOnly = true) {
  const filters: unknown[] = activeOnly ? [["is_active", "=", 1]] : [];
  const rows = await erpList<any>(DT.STYLE_LIBRARY, {
    filters,
    fields: ["name", "category", "style_name", "description", "image_url", "is_active", "creation", "modified"],
    order_by: "category asc, style_name asc",
    limit: 500,
  });
  if (rows.length) return rows;
  // ERP Style Library empty — serve house defaults so intake chips still work.
  return DEFAULT_STYLE_CATALOG.map((s) => ({
    ...s,
    image_url: null,
    is_active: 1,
    creation: null,
    modified: null,
    _fallback: true,
  }));
}

export function serializeStyle(row: any) {
  return {
    id: row.name,
    category: row.category,
    name: row.style_name ?? row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isActive: row.is_active !== 0,
    createdAt: row.creation,
    updatedAt: row.modified,
  };
}

export async function createStyle(body: any) {
  return erpCreate(DT.STYLE_LIBRARY, {
    category: body.category,
    style_name: body.name,
    description: body.description ?? null,
    image_url: body.imageUrl ?? null,
    is_active: 1,
  });
}

export async function updateStyle(id: string, body: any) {
  const mapped: Record<string, unknown> = {};
  if (body.category !== undefined) mapped.category = body.category;
  if (body.name !== undefined) mapped.style_name = body.name;
  if (body.description !== undefined) mapped.description = body.description;
  if (body.imageUrl !== undefined) mapped.image_url = body.imageUrl;
  if (body.isActive !== undefined) mapped.is_active = body.isActive ? 1 : 0;
  return erpUpdate(DT.STYLE_LIBRARY, id, mapped);
}

// ─── Tailors (Employee doctype) ───────────────────────────────────────────

export async function listTailors(locationCode?: string | null) {
  const filters: unknown[] = [["status", "=", "Active"], ["designation", "like", "%Tailor%"]];
  if (locationCode) filters.push(["branch", "=", locationCode]);
  return erpList<any>(DT.EMPLOYEE, {
    filters,
    fields: ["name", "employee_name", "designation", "branch", "creation"],
    order_by: "employee_name asc",
    limit: 100,
  });
}

export function serializeTailor(row: any) {
  return {
    id: row.name,
    name: row.employee_name,
    locationId: row.branch ?? null,
    isActive: true,
    createdAt: row.creation,
    location: null,
  };
}

export async function createTailor(body: { name: string; locationId: string }) {
  return erpCreate(DT.EMPLOYEE, {
    employee_name: body.name,
    first_name: body.name.split(" ")[0] ?? body.name,
    last_name: body.name.split(" ").slice(1).join(" ") || body.name,
    designation: "Tailor",
    branch: body.locationId,
    status: "Active",
    gender: "Other",
    date_of_birth: "1990-01-01",
    date_of_joining: new Date().toISOString().slice(0, 10),
  });
}

export async function updateTailor(id: string, body: any) {
  const mapped: Record<string, unknown> = {};
  if (body.name !== undefined) mapped.employee_name = body.name;
  if (body.locationId !== undefined) mapped.branch = body.locationId;
  if (body.isActive !== undefined) mapped.status = body.isActive ? "Active" : "Inactive";
  return erpUpdate(DT.EMPLOYEE, id, mapped);
}
