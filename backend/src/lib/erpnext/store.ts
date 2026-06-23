// Generic ERPNext document store — replaces Supabase table operations for AI ops + misc data.
import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";

export interface StoreListOpts {
  filters?: unknown[];
  fields?: string[];
  orderBy?: string;
  limit?: number;
}

export async function storeList<T = Record<string, unknown>>(
  doctype: string,
  opts: StoreListOpts = {},
): Promise<T[]> {
  return erpList<T>(doctype, {
    filters: opts.filters,
    fields: opts.fields,
    order_by: opts.orderBy,
    limit: opts.limit ?? 200,
  });
}

export async function storeGet<T = Record<string, unknown>>(
  doctype: string,
  name: string,
): Promise<T | null> {
  return erpGet<T>(doctype, name);
}

export async function storeInsert<T = Record<string, unknown>>(
  doctype: string,
  doc: Record<string, unknown>,
): Promise<T | null> {
  return erpCreate<T>(doctype, doc);
}

export async function storeUpdate<T = Record<string, unknown>>(
  doctype: string,
  name: string,
  doc: Record<string, unknown>,
): Promise<T | null> {
  return erpUpdate<T>(doctype, name, doc);
}

/** Find first row matching a field value. */
export async function storeFindOne<T = Record<string, unknown>>(
  doctype: string,
  field: string,
  value: unknown,
  fields?: string[],
): Promise<T | null> {
  const rows = await storeList<T>(doctype, {
    filters: [[field, "=", value]],
    fields,
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Like Supabase .ilike — uses ERPNext 'like' filter. */
export async function storeSearch<T = Record<string, unknown>>(
  doctype: string,
  field: string,
  query: string,
  opts: { limit?: number; fields?: string[]; extraFilters?: unknown[] } = {},
): Promise<T[]> {
  const filters: unknown[] = [...(opts.extraFilters ?? []), [field, "like", `%${query}%`]];
  return storeList<T>(doctype, {
    filters,
    fields: opts.fields,
    limit: opts.limit ?? 10,
  });
}

/** Insert row; on duplicate key field, update instead. */
export async function storeUpsert(
  doctype: string,
  doc: Record<string, unknown>,
  keyField: string,
): Promise<Record<string, unknown>> {
  const keyVal = doc[keyField];
  if (keyVal) {
    const existing = await storeFindOne(doctype, keyField, keyVal);
    if (existing && (existing as any).name) {
      const updated = await storeUpdate(doctype, (existing as any).name, doc);
      return (updated ?? existing) as Record<string, unknown>;
    }
  }
  const created = await storeInsert(doctype, doc);
  if (!created) throw new Error(`Failed to upsert ${doctype}`);
  return created as Record<string, unknown>;
}
