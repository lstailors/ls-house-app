import { api } from "./api";
import type { ErpDoctypeSchema, ErpFilter } from "./types";

export interface ErpListOptions {
  filters?: ErpFilter[];
  fields?: string[];
  limit?: number;
  limit_page_length?: number;
  limit_start?: number;
  order_by?: string;
}

function resourcePath(doctype: string, name?: string): string {
  const base = `/api/erp-rest/resource/${encodeURIComponent(doctype)}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

function withListParams(path: string, opts: ErpListOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.filters) params.set("filters", JSON.stringify(opts.filters));
  if (opts.fields) params.set("fields", JSON.stringify(opts.fields));
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.limit_page_length) params.set("limit_page_length", String(opts.limit_page_length));
  if (opts.limit_start !== undefined) params.set("limit_start", String(opts.limit_start));
  if (opts.order_by) params.set("order_by", opts.order_by);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export const erpRest = {
  list: <T = unknown>(doctype: string, opts?: ErpListOptions) =>
    api.get<T[]>(withListParams(resourcePath(doctype), opts)),

  get: <T = unknown>(doctype: string, name: string) =>
    api.get<T>(resourcePath(doctype, name)),

  create: <T = unknown>(doctype: string, doc: Record<string, unknown>) =>
    api.post<T>(resourcePath(doctype), doc),

  update: <T = unknown>(doctype: string, name: string, doc: Record<string, unknown>) =>
    api.patch<T>(resourcePath(doctype, name), doc),

  delete: (doctype: string, name: string) =>
    api.delete<{ ok: true }>(resourcePath(doctype, name)),

  count: (doctype: string, filters?: ErpFilter[]) => {
    const params = new URLSearchParams();
    if (filters) params.set("filters", JSON.stringify(filters));
    const query = params.toString();
    return api.get<number>(`${resourcePath(doctype)}/count${query ? `?${query}` : ""}`);
  },

  doctypeFields: (doctype: string) =>
    api.get<ErpDoctypeSchema>(`${resourcePath(doctype)}/fields`),

  runMethod: <T = unknown>(method: string, params?: Record<string, unknown>) =>
    api.post<T>(`/api/erp-rest/method/${encodeURIComponent(method)}`, params ?? {}),
};
