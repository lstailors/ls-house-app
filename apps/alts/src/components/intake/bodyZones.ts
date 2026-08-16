/**
 * Body zones for intake redesign v2 — map ERP Alteration Preset groups → body area.
 * Zones are a UI lens only; billing still uses leaf presets + item_code.
 */
import type { BodyZoneId } from "@alts/components/intake/GarmentZoneIcon";

export type PresetLike = {
  id: string;
  name?: string;
  display_name?: string;
  preset_name?: string;
  parent_preset?: string | null;
  is_group?: number | boolean;
};

export type BodyZoneDef = {
  id: BodyZoneId;
  name: string;
  /** Match against display_name / preset_name (lowercase) */
  match: (label: string) => boolean;
};

function has(label: string, ...needles: string[]) {
  return needles.some((n) => label.includes(n));
}

const JACKET_ZONES: BodyZoneDef[] = [
  { id: "sleeves", name: "Sleeves", match: (l) => has(l, "sleeve") },
  { id: "shoulders", name: "Shoulders", match: (l) => has(l, "shoulder") },
  { id: "collar", name: "Collar & lapels", match: (l) => has(l, "collar", "lapel") },
  {
    id: "body",
    name: "Body & waist",
    match: (l) =>
      has(l, "take in", "take-in", "let out", "let-out", "side", "blade", "dart", "waist", "body") &&
      !has(l, "sleeve", "shoulder", "collar"),
  },
  {
    id: "length",
    name: "Length & hem",
    match: (l) => has(l, "hem", "lengthen", "shorten") && !has(l, "sleeve"),
  },
  { id: "lining", name: "Lining", match: (l) => has(l, "lining") },
  { id: "buttons", name: "Buttons", match: (l) => has(l, "button") },
  {
    id: "repairs",
    name: "Repairs & custom",
    match: (l) =>
      has(l, "repair", "make", "custom", "change", "other", "reweave", "patch", "iron"),
  },
];

const TROUSER_ZONES: BodyZoneDef[] = [
  {
    id: "waist",
    name: "Waist & band",
    match: (l) => has(l, "waist", "band", "elastic"),
  },
  {
    id: "seat",
    name: "Seat & crotch",
    match: (l) => has(l, "seat", "crotch"),
  },
  {
    id: "legs",
    name: "Legs & taper",
    match: (l) => has(l, "taper", "leg", "thigh", "knee") && !has(l, "shorten", "lengthen"),
  },
  {
    id: "hem",
    name: "Hem & length",
    match: (l) => has(l, "shorten", "lengthen", "hem", "cuff"),
  },
  {
    id: "zipper",
    name: "Zipper & fly",
    match: (l) => has(l, "zipper", "fly", "hook"),
  },
  {
    id: "repairs",
    name: "Repairs & custom",
    match: (l) => has(l, "repair", "make", "custom", "pleat", "pocket", "other", "iron"),
  },
];

export function zonesForGarment(garmentType: string): BodyZoneDef[] {
  const g = (garmentType || "").toLowerCase();
  if (g.includes("trouser") || g.includes("pant") || g.includes("jean")) return TROUSER_ZONES;
  if (
    g.includes("jacket") ||
    g.includes("coat") ||
    g.includes("blazer") ||
    g.includes("suit") ||
    g.includes("vest")
  )
    return JACKET_ZONES;
  return [
    {
      id: "body",
      name: "Fit & body",
      match: (l) => has(l, "take in", "let out", "side", "dart", "waist", "body"),
    },
    { id: "sleeves", name: "Sleeves", match: (l) => has(l, "sleeve") },
    {
      id: "length",
      name: "Length & hem",
      match: (l) => has(l, "hem", "lengthen", "shorten"),
    },
    {
      id: "repairs",
      name: "Repairs & custom",
      match: (l) => has(l, "repair", "make", "custom", "button", "other"),
    },
  ];
}

export function labelOfPreset(p: PresetLike) {
  return (p.display_name || p.preset_name || p.id || "").trim();
}

export function matchZone(p: PresetLike, zones: BodyZoneDef[]): BodyZoneId | null {
  const l = labelOfPreset(p).toLowerCase();
  for (const z of zones) {
    if (z.match(l)) return z.id;
  }
  return null;
}

export function isGroup(p: PresetLike) {
  return p.is_group === 1 || p.is_group === true;
}

function groupKeys(p: PresetLike): string[] {
  return [p.id, p.name, p.preset_name].filter(Boolean) as string[];
}

/** Every quote line in a zone — leaf label or parent folder, not just starred Quick actions. */
export function leavesForZone<T extends PresetLike>(presets: T[], zone: BodyZoneDef): T[] {
  const parentKeys = new Set<string>();
  for (const p of presets) {
    if (isGroup(p) && zone.match(labelOfPreset(p).toLowerCase())) {
      for (const key of groupKeys(p)) parentKeys.add(key);
    }
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of presets) {
    if (isGroup(p) || seen.has(p.id)) continue;
    const inZone =
      zone.match(labelOfPreset(p).toLowerCase()) ||
      (!!p.parent_preset && parentKeys.has(p.parent_preset));
    if (!inZone) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
