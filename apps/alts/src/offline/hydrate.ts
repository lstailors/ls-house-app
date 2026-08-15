import { api } from "@ls/api-client";
import type { OfflineSnapshot } from "@ls/types";
import type { QueryClient } from "@tanstack/react-query";
import {
  collectionSyncedAt,
  oldestHotSync,
  putMeta,
  readCollection,
  replaceCollection,
  type OfflineCollectionName,
} from "./db";
import { isShopOffline } from "./status";
import { customerToList, houseToUi, invoiceToUi, qcToUi } from "./map";

const COLLECTIONS: OfflineCollectionName[] = [
  "tickets",
  "houseOrders",
  "appointments",
  "customers",
  "invoices",
  "catalog",
  "qc",
];

export async function hydrateOfflineSnapshot(opts?: { force?: boolean }): Promise<OfflineSnapshot | null> {
  if (isShopOffline() && !opts?.force) return null;
  const since = opts?.force ? "" : ((await oldestHotSync()) ?? "");
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await api.raw(`/api/offline/snapshot${q}`);
  const j = await res.json().catch(() => ({} as { data?: OfflineSnapshot; error?: { message?: string } }));
  if (!res.ok) throw new Error(j?.error?.message || "Offline snapshot failed");
  const data = (j?.data ?? j) as OfflineSnapshot;
  const incremental = Boolean(since);
  for (const name of COLLECTIONS) {
    const col = data.collections[name];
    if (!col) continue;
    await replaceCollection(name, col.rows as Record<string, unknown>[], col.lastSyncedAt, incremental);
  }
  await putMeta("snapshotAt", data.generated_at);
  return data;
}

export async function seedQueryCache(qc: QueryClient) {
  const tickets = await readCollection("tickets");
  if (tickets.length) {
    qc.setQueryData(["shop-floor-tickets"], tickets);
    qc.setQueryData(["orders-glass"], tickets);
    qc.setQueryData(["xfer-tickets"], tickets);
    qc.setQueryData(["quote-open-tickets"], tickets);
    qc.setQueryData(["alts-house-tickets"], tickets);
    qc.setQueryData(
      ["pickup-ready"],
      tickets.filter((t) => String((t as { workflow_state?: string }).workflow_state) === "Ready"),
    );
  }
  const invoices = await readCollection("invoices");
  if (invoices.length) {
    const rows = invoices.map(invoiceToUi);
    qc.setQueryData(["pickup-open-invoices"], rows);
    qc.setQueryData(["alts-invoices", "open", ""], {
      rows,
      summary: { paid: 0, outstanding: 0, openCount: rows.length, count: rows.length },
    });
  }
  const house = await readCollection("houseOrders");
  if (house.length) qc.setQueryData(["alts-custom-orders"], house.map(houseToUi));
  const catalog = await readCollection("catalog");
  if (catalog.length) qc.setQueryData(["presets", "NYC"], catalog);
  const qcRows = await readCollection("qc");
  if (qcRows.length) {
    const mapped = qcRows.map(qcToUi);
    qc.setQueryData(["alts-qc", "waiting", ""], mapped);
    qc.setQueryData(["qc-inspections"], mapped);
  }
  const customers = await readCollection("customers");
  if (customers.length) {
    const mapped = customers.map(customerToList);
    qc.setQueryData(["customers", "Active", "All", "", 100], {
      customers: mapped.slice(0, 100),
      total: mapped.length,
      mode: "browse",
    });
    qc.setQueryData(["customers-book-total"], { total: mapped.length });
  }
}

export async function startOfflineHydrate(qc: QueryClient) {
  await seedQueryCache(qc).catch(() => undefined);
  const tick = async () => {
    if (isShopOffline()) return;
    try {
      await hydrateOfflineSnapshot();
      await seedQueryCache(qc);
    } catch {
      /* keep last cache */
    }
  };
  void tick();
  const id = window.setInterval(() => void tick(), 3 * 60_000);
  return () => window.clearInterval(id);
}

export async function snapshotLabel(): Promise<string | null> {
  return (await collectionSyncedAt("tickets")) ?? (await oldestHotSync());
}
