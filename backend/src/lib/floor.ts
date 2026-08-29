export type RawTicket = {
  name: string;
  customer_name?: string;
  due_date?: string;
  due_time?: string;
  promised_date?: string;
  is_rush?: number | boolean;
  workflow_state?: string;
  lsh_rack_number?: string;
  lsh_rack_location?: string;
  garments?: any[];
  lines?: any[];
};

export type FloorScan =
  | { kind: "garment"; ticket: string; garment: string }
  | { kind: "ticket"; ticket: string }
  | { kind: "invoice"; invoice: string }
  | { kind: "token"; token: string };

export const TRANSFER_DESTINATIONS = {
  Stella: { warehouse: "Home Tailor One - LSTNY", employee: "HR-EMP-00020" },
  Hugo: { warehouse: "Home Tailor Two - LSTNY", employee: "HR-EMP-00021" },
  Munro: { warehouse: "Munro - LSTNY", employee: "" },
  Floor: { warehouse: "Work In Progress - LSTNY", employee: "" },
} as const;

export function destinationFor(name: string) {
  const found = TRANSFER_DESTINATIONS[name as keyof typeof TRANSFER_DESTINATIONS];
  if (!found) throw new Error("Choose Stella, Hugo, Munro, or Floor");
  return found;
}

export function parseFloorScan(value: string): FloorScan {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Scan was empty");
  if (raw.length > 256) throw new Error("Scan token is too long");

  let path = raw;
  try {
    const url = new URL(raw);
    const token = url.searchParams.get("token")?.trim();
    if (token) return { kind: "token", token };
    path = decodeURIComponent(url.pathname);
  } catch { /* plain scan */ }

  const garment = path.match(/\/g\/((?:LS-)?ALT-[A-Z0-9-]+)\/([^/?#]+)/i)
    || raw.match(/^((?:LS-)?ALT-[A-Z0-9-]+)[/:](G\d+)$/i);
  if (garment) return { kind: "garment", ticket: garment[1]!, garment: garment[2]!.toUpperCase() };

  const ticketUrl = path.match(/\/(?:t|e-ticket)\/((?:LS-)?ALT-[A-Z0-9-]+)/i);
  if (ticketUrl) return { kind: "ticket", ticket: ticketUrl[1]! };
  if (/^(?:LS-)?ALT-[A-Z0-9-]+$/i.test(raw)) return { kind: "ticket", ticket: raw };
  if (/^(?:LSTNY-|LSTX-|ACC-)?SINV-[A-Z0-9-]+$/i.test(raw)) return { kind: "invoice", invoice: raw };
  if (/^G\d+$/i.test(raw)) throw new Error("Garment ID needs its ticket number");
  return { kind: "token", token: raw };
}

export function presentTicket(ticket: RawTicket, selectedGarment?: string) {
  const lines = ticket.lines ?? [];
  const garments = (ticket.garments ?? []).map((g) => {
    const ownLines = lines.filter((l) => String(l.garment_ref || "") === String(g.garment_id || ""));
    return {
      rowName: String(g.name || ""),
      garmentId: String(g.garment_id || ""),
      qrToken: String(g.qr_token || ""),
      garmentType: String(g.garment_type || "Garment"),
      description: String(g.description || g.color || ""),
      currentLocation: String(g.current_location || "Work In Progress - LSTNY"),
      status: String(g.garment_status || "Received"),
      completedBy: String(g.completed_by || ""),
      actualMinutes: Number(g.actual_minutes || 0),
      work: ownLines.map((l) => String(l.description || l.preset || "Work")).filter(Boolean),
    };
  });
  return {
    ticket: ticket.name,
    customer: ticket.customer_name || "Client",
    dueDate: ticket.due_date || ticket.promised_date || "",
    dueTime: ticket.due_time || "",
    rush: Boolean(ticket.is_rush),
    workflowState: ticket.workflow_state || "Received",
    rackNumber: ticket.lsh_rack_number || "",
    rackLocation: ticket.lsh_rack_location || "",
    selectedGarment: selectedGarment || null,
    garments,
    allDone: garments.length > 0 && garments.every((g) => g.status === "Ready" || g.status === "Picked Up"),
  };
}

export function completionPatches(ticket: RawTicket, garmentId: string, tailor: string, minutes: number, note: string, now: string) {
  if (!tailor) throw new Error("Choose a tailor");
  if (![15, 30, 45, 60, 75, 90, 120, 150, 180].includes(minutes)) throw new Error("Choose a time chip");
  const garment = (ticket.garments ?? []).find((g) => String(g.garment_id) === garmentId || String(g.name) === garmentId);
  if (!garment) throw new Error(`Garment ${garmentId} not found on ${ticket.name}`);
  const cleanNote = String(note || "").trim().slice(0, 1000);
  return {
    garmentName: String(garment.name),
    garment: { garment_status: "Ready", completed_by: tailor, completed_at: now, tailor_completed_at: now, actual_minutes: minutes },
    lines: (ticket.lines ?? [])
      .filter((l) => String(l.garment_ref || "") === String(garment.garment_id || ""))
      .map((l) => ({ name: String(l.name), patch: { tailor, line_status: "Done", actual_minutes: minutes, line_notes: cleanNote } })),
  };
}

export function rackPatch(number: string, location: string) {
  const rack = String(number || "").trim().slice(0, 80);
  const where = String(location || "").trim().slice(0, 140);
  if (!rack) throw new Error("Enter a rack number");
  if (!where) throw new Error("Enter a rack location");
  return { workflow_state: "Ready", lsh_rack_number: rack, lsh_rack_location: where };
}
