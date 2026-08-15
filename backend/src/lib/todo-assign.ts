import { erpCreate, erpList, erpUpdate } from "./erp";

export function isAutoAssignmentTodo(description: string | null | undefined): boolean {
  return /automatic assignment/i.test(String(description ?? ""));
}

export async function findOpenAssignment(opts: {
  reference_type: string;
  reference_name: string;
  allocated_to: string;
}) {
  const rows = await erpList<any>("ToDo", {
    filters: [
      ["status", "=", "Open"],
      ["reference_type", "=", opts.reference_type],
      ["reference_name", "=", opts.reference_name],
      ["allocated_to", "=", opts.allocated_to],
    ],
    fields: ["name", "description", "status", "allocated_to", "reference_type", "reference_name"],
    limit: 5,
  });
  return rows[0] ?? null;
}

/** One open assignment ToDo per ticket per assignee — upsert, never insert a duplicate. */
export async function upsertOpenAssignment(doc: Record<string, unknown>) {
  const reference_type = String(doc.reference_type || "");
  const reference_name = String(doc.reference_name || "");
  const allocated_to = String(doc.allocated_to || "");
  if (reference_type && reference_name && allocated_to && isAutoAssignmentTodo(String(doc.description || ""))) {
    const existing = await findOpenAssignment({ reference_type, reference_name, allocated_to });
    if (existing) {
      const next: Record<string, unknown> = {};
      if (doc.description && existing.description !== doc.description) next.description = doc.description;
      if (doc.priority) next.priority = doc.priority;
      if (doc.date) next.date = doc.date;
      if (Object.keys(next).length) {
        const updated = await erpUpdate("ToDo", existing.name, next);
        return updated ?? existing;
      }
      return existing;
    }
  }
  return erpCreate("ToDo", doc);
}
