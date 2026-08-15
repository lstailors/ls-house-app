import Dexie, { type Table } from "dexie";

export type OfflineCollectionName =
  | "tickets"
  | "houseOrders"
  | "appointments"
  | "customers"
  | "invoices"
  | "catalog"
  | "qc";

export type OfflineRow = {
  id: string;
  collection: OfflineCollectionName;
  modified?: string;
  data: Record<string, unknown>;
};

export type OfflineMeta = {
  key: string;
  value: unknown;
};

class AltsOfflineDb extends Dexie {
  rows!: Table<OfflineRow, string>;
  meta!: Table<OfflineMeta, string>;

  constructor() {
    super("alts-offline");
    this.version(1).stores({
      rows: "id, collection, modified",
      meta: "key",
    });
  }
}

export const offlineDb = new AltsOfflineDb();

export function rowId(collection: OfflineCollectionName, name: string) {
  return `${collection}:${name}`;
}

export async function replaceCollection(
  collection: OfflineCollectionName,
  rows: Record<string, unknown>[],
  lastSyncedAt: string,
  incremental = false,
) {
  const mapped: OfflineRow[] = [];
  for (const data of rows) {
    const name = String(data.name ?? data.id ?? "");
    if (!name) continue;
    mapped.push({
      id: rowId(collection, name),
      collection,
      modified: String(data.modified ?? lastSyncedAt),
      data,
    });
  }

  await offlineDb.transaction("rw", offlineDb.rows, offlineDb.meta, async () => {
    if (!incremental) {
      await offlineDb.rows.where("collection").equals(collection).delete();
    }
    if (mapped.length) await offlineDb.rows.bulkPut(mapped);
    await offlineDb.meta.put({ key: `lastSyncedAt:${collection}`, value: lastSyncedAt });
  });
}

export async function readCollection<T = Record<string, unknown>>(
  collection: OfflineCollectionName,
): Promise<T[]> {
  const rows = await offlineDb.rows.where("collection").equals(collection).toArray();
  return rows.map((r) => r.data as T);
}

export async function readRow<T = Record<string, unknown>>(
  collection: OfflineCollectionName,
  name: string,
): Promise<T | undefined> {
  const row = await offlineDb.rows.get(rowId(collection, name));
  return row?.data as T | undefined;
}

export async function collectionSyncedAt(collection: OfflineCollectionName): Promise<string | null> {
  const row = await offlineDb.meta.get(`lastSyncedAt:${collection}`);
  return typeof row?.value === "string" ? row.value : null;
}

export async function oldestHotSync(): Promise<string | null> {
  const keys: OfflineCollectionName[] = [
    "tickets",
    "appointments",
    "customers",
    "invoices",
    "catalog",
    "qc",
    "houseOrders",
  ];
  const times = await Promise.all(keys.map((k) => collectionSyncedAt(k)));
  const present = times.filter((t): t is string => !!t);
  if (!present.length) return null;
  return present.sort()[0] ?? null;
}

export async function putMeta(key: string, value: unknown) {
  await offlineDb.meta.put({ key, value });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await offlineDb.meta.get(key);
  return row?.value as T | undefined;
}
