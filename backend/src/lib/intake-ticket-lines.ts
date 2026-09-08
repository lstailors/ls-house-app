export type IntakeGarmentLineInput = {
  id?: string;
  client_line_key?: string;
  clientKey?: string;
  preset?: string | null;
  description?: string;
  price?: number;
  estMinutes?: number;
  est_minutes?: number;
  estimated_minutes?: number;
  notes?: string;
  line_notes?: string;
};

export type IntakeGarmentInput = {
  ref?: string;
  lines?: IntakeGarmentLineInput[];
};

export function buildTicketLines(
  garments: IntakeGarmentInput[],
  sellOnlyDescription = "",
) {
  const rows = garments.flatMap((garment) =>
    (garment.lines ?? []).map((line) => ({
      garment_ref: garment.ref,
      preset: line.preset || null,
      description: line.description,
      price: line.price,
      estimated_minutes:
        Number(line.estMinutes ?? line.est_minutes ?? line.estimated_minutes) || 15,
      line_notes: line.notes || line.line_notes || null,
      client_line_key: line.id || line.client_line_key || line.clientKey || null,
    })),
  );

  if (rows.length === 0 && sellOnlyDescription.trim()) {
    rows.push({
      garment_ref: garments[0]?.ref || "G1",
      preset: null,
      description: sellOnlyDescription.trim(),
      price: 0,
      estimated_minutes: 15,
      line_notes: "Shell line for sell/MTM/wholesale charge",
      client_line_key: "sell-shell",
    });
  }

  return rows;
}
