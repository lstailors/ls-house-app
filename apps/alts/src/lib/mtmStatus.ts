/** Live ERPNext MTM / make-order statuses — same list as backend/src/lib/qc.ts */
export const MTM_STATUSES = [
  { key: "Consultation", color: "gray" },
  { key: "Order Submitted", color: "blue" },
  { key: "Fabric PO Raised", color: "purple" },
  { key: "Fabric In Transit", color: "teal" },
  { key: "Received at Facility", color: "teal" },
  { key: "Cutting", color: "orange" },
  { key: "Production", color: "orange" },
  { key: "Shipped to Store", color: "brass" },
  { key: "Received at Store", color: "brass" },
  { key: "Quality Control", color: "rose" },
  { key: "Awaiting Fitting", color: "blue" },
  { key: "Awaiting Shipment", color: "blue" },
  { key: "Alterations", color: "purple" },
  { key: "Fitting", color: "green" },
  { key: "Delivered", color: "forest" },
  { key: "Cancelled", color: "red" },
] as const;

export type MtmStatusKey = (typeof MTM_STATUSES)[number]["key"];

export const MTM_STATUS_KEYS: readonly string[] = MTM_STATUSES.map((s) => s.key);

export function isMtmStatus(value: string | null | undefined): value is MtmStatusKey {
  return !!value && MTM_STATUS_KEYS.includes(value);
}
