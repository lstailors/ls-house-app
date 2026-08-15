#!/usr/bin/env bun
/**
 * Close duplicate ERP ToDos titled "Automatic Assignment".
 * Keeps the oldest open ToDo per (HD ticket, assignee).
 *
 *   bun run src/scripts/cleanup-auto-assignment-todos.ts
 *   bun run src/scripts/cleanup-auto-assignment-todos.ts --apply
 */
import "../load-env";
import { erpList, erpUpdate } from "../lib/erp";
import { isAutoAssignmentTodo } from "../lib/todo-assign";

const APPLY = process.argv.includes("--apply");
const PAGE = 200;

async function main() {
  const open: any[] = [];
  let start = 0;
  for (;;) {
    const rows = await erpList<any>("ToDo", {
      filters: [["status", "=", "Open"]],
      fields: ["name", "description", "allocated_to", "reference_type", "reference_name", "creation"],
      limit: PAGE,
      start,
      order_by: "creation asc",
    });
    if (!rows.length) break;
    open.push(...rows);
    if (rows.length < PAGE) break;
    start += PAGE;
  }

  const auto = open.filter((t) => isAutoAssignmentTodo(t.description));
  const groups = new Map<string, any[]>();
  for (const t of auto) {
    const key = `${t.reference_type || ""}|${t.reference_name || t.name}|${t.allocated_to || ""}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  let keep = 0;
  let close = 0;
  for (const [, list] of groups) {
    const sorted = list.sort((a, b) => String(a.creation).localeCompare(String(b.creation)));
    keep += 1;
    const dupes = sorted.slice(1);
    close += dupes.length;
    for (const d of dupes) {
      console.info(
        JSON.stringify({
          event: "todo.duplicate",
          name: d.name,
          reference: d.reference_name,
          assignee: d.allocated_to,
          action: APPLY ? "close" : "dry_run",
        }),
      );
      if (APPLY) {
        await erpUpdate("ToDo", d.name, { status: "Cancelled" });
      }
    }
  }

  console.info(
    JSON.stringify({
      event: "todo.cleanup_summary",
      open: open.length,
      auto: auto.length,
      groups: groups.size,
      keep,
      close,
      apply: APPLY,
    }),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "todo.cleanup_failed", error: (e as Error).message }));
  process.exit(1);
});
