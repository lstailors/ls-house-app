import { isShopOffline } from "./status";
import { readCollection, readRow, type OfflineCollectionName } from "./db";
import {
  appointmentToUi,
  customerToDetail,
  customerToHit,
  customerToList,
  eventToHouse,
  houseToUi,
  inDayRange,
  invoiceToUi,
  matchesCustomer,
  qcToUi,
} from "./map";

/** Network first while online; Dexie when offline or when the request fails. */
export async function localFirstList<T>(
  collection: OfflineCollectionName,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  if (isShopOffline()) {
    return (await readCollection(collection)) as T[];
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readCollection(collection);
    if (cached.length) return cached as T[];
    throw e;
  }
}

export async function localFirstRow<T>(
  collection: OfflineCollectionName,
  name: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (isShopOffline()) {
    const cached = await readRow(collection, name);
    if (cached) return cached as T;
    throw new Error("Offline — this record is not on this device.");
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readRow(collection, name);
    if (cached) return cached as T;
    throw e;
  }
}

export async function localFirstTickets<T>(
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  return localFirstList("tickets", fetcher);
}

export async function localFirstReadyTickets<T extends { workflow_state?: string }>(
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  const rows = await localFirstList("tickets", fetcher as () => Promise<Record<string, unknown>[]>);
  return rows.filter((t) => String((t as T).workflow_state) === "Ready") as T[];
}

export async function localFirstInvoices<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  if (isShopOffline()) {
    return (await readCollection("invoices")).map(invoiceToUi) as T[];
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readCollection("invoices");
    if (cached.length) return cached.map(invoiceToUi) as T[];
    throw e;
  }
}

export async function localFirstInvoiceBook<T extends { outstandingAmount?: number }>(
  fetcher: () => Promise<{ rows: T[]; summary: { paid: number; outstanding: number; openCount: number; count: number } }>,
): Promise<{ rows: T[]; summary: { paid: number; outstanding: number; openCount: number; count: number } }> {
  if (isShopOffline()) {
    const rows = (await readCollection("invoices")).map(invoiceToUi) as unknown as T[];
    return invoiceSummary(rows);
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readCollection("invoices");
    if (!cached.length) throw e;
    return invoiceSummary(cached.map(invoiceToUi) as unknown as T[]);
  }
}

function invoiceSummary<T extends { outstandingAmount?: number }>(rows: T[]) {
  const outstanding = rows.reduce((s, r) => s + (Number(r.outstandingAmount) || 0), 0);
  return {
    rows,
    summary: {
      paid: 0,
      outstanding,
      openCount: rows.filter((r) => (Number(r.outstandingAmount) || 0) > 0.005).length,
      count: rows.length,
    },
  };
}

export async function localFirstHouseOrders<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  if (isShopOffline()) {
    return (await readCollection("houseOrders")).map(houseToUi) as T[];
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readCollection("houseOrders");
    if (cached.length) return cached.map(houseToUi) as T[];
    throw e;
  }
}

export async function localFirstCatalog<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  return localFirstList("catalog", fetcher as () => Promise<Record<string, unknown>[]>) as Promise<T[]>;
}

export async function localFirstQc<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  if (isShopOffline()) {
    return (await readCollection("qc")).map(qcToUi) as T[];
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readCollection("qc");
    if (cached.length) return cached.map(qcToUi) as T[];
    throw e;
  }
}

export async function localFirstAppointments<T, B = unknown>(
  from: string,
  to: string,
  fetcher: () => Promise<{ appointments: T[]; blocks: B[] }>,
): Promise<{ appointments: T[]; blocks: B[] }> {
  const fromCache = async () => {
    const rows = await readCollection("appointments");
    const appointments = rows
      .filter((r) => r._kind !== "event")
      .filter((r) => inDayRange(String(r.scheduled_time ?? r.scheduledTime ?? ""), from, to))
      .map(appointmentToUi) as T[];
    return { appointments, blocks: [] as B[] };
  };
  if (isShopOffline()) return fromCache();
  try {
    return await fetcher();
  } catch (e) {
    const cached = await fromCache();
    if (cached.appointments.length) return cached;
    throw e;
  }
}

export async function localFirstHouseCal<T>(
  from: string,
  to: string,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  const fromCache = async () => {
    const rows = await readCollection("appointments");
    return rows
      .filter((r) => r._kind === "event")
      .filter((r) => inDayRange(String(r.starts_on ?? r.start ?? ""), from, to))
      .map(eventToHouse) as T[];
  };
  if (isShopOffline()) return fromCache();
  try {
    return await fetcher();
  } catch (e) {
    const cached = await fromCache();
    if (cached.length) return cached;
    throw e;
  }
}

export async function localFirstCustomers<T>(
  fetcher: () => Promise<{ customers: T[]; total: number; mode: string }>,
  q = "",
) {
  const fromCache = async () => {
    const rows = (await readCollection("customers")).filter((r) => matchesCustomer(r, q));
    const customers = rows.map(customerToList) as T[];
    return { customers, total: customers.length, mode: q ? "search" : "browse" };
  };
  if (isShopOffline()) return fromCache();
  try {
    return await fetcher();
  } catch (e) {
    const cached = await fromCache();
    if (cached.customers.length) return cached;
    throw e;
  }
}

export async function localFirstCustomerBookTotal(fetcher: () => Promise<{ total: number }>) {
  if (isShopOffline()) {
    const rows = await readCollection("customers");
    return { total: rows.length };
  }
  try {
    return await fetcher();
  } catch (e) {
    const rows = await readCollection("customers");
    if (rows.length) return { total: rows.length };
    throw e;
  }
}

export async function localFirstCustomerSearch<T>(q: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const fromCache = async () => {
    const rows = (await readCollection("customers")).filter((r) => matchesCustomer(r, q));
    return rows.map(customerToHit) as T[];
  };
  if (isShopOffline()) return fromCache();
  try {
    return await fetcher();
  } catch (e) {
    const cached = await fromCache();
    if (cached.length) return cached;
    throw e;
  }
}

export async function localFirstCustomerRow<T>(id: string, fetcher: () => Promise<T>): Promise<T> {
  if (isShopOffline()) {
    const cached = await readRow("customers", id);
    if (cached) return customerToDetail(cached) as T;
    throw new Error("Offline — this client is not on this device.");
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = await readRow("customers", id);
    if (cached) return customerToDetail(cached) as T;
    throw e;
  }
}

export async function localFirstTicketSearch<T extends { name?: string; customer_name?: string; customer_phone?: string }>(
  q: string,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  const s = q.toLowerCase();
  const filter = (rows: T[]) =>
    rows.filter(
      (t) =>
        String(t.name ?? "").toLowerCase().includes(s) ||
        String(t.customer_name ?? "").toLowerCase().includes(s) ||
        String(t.customer_phone ?? "").includes(s),
    );
  if (isShopOffline()) {
    return filter((await readCollection("tickets")) as T[]);
  }
  try {
    return await fetcher();
  } catch (e) {
    const cached = filter((await readCollection("tickets")) as T[]);
    if (cached.length) return cached;
    throw e;
  }
}
