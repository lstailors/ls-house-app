import { api } from "./api";
import type {
  ErpCountRequest,
  ErpCreateRequest,
  ErpDoctypeFieldsRequest,
  ErpDoctypeSchema,
  ErpGetRequest,
  ErpListRequest,
  ErpRunMethodRequest,
  ErpUpdateRequest,
} from "./types";

export const erpMcp = {
  erp_ping: () =>
    api.get<{ ok: boolean; baseUrl: string; authMode: string }>("/api/mcp/ping"),

  erp_list: <T = unknown>(input: ErpListRequest) =>
    api.post<T[]>("/api/mcp/erp/list", input),

  erp_get: <T = unknown>(input: ErpGetRequest) =>
    api.post<T>("/api/mcp/erp/get", input),

  erp_create: <T = unknown>(input: ErpCreateRequest) =>
    api.post<T>("/api/mcp/erp/create", input),

  erp_update: <T = unknown>(input: ErpUpdateRequest) =>
    api.post<T>("/api/mcp/erp/update", input),

  erp_count: (input: ErpCountRequest) =>
    api.post<number>("/api/mcp/erp/count", input),

  erp_doctype_fields: (input: ErpDoctypeFieldsRequest) =>
    api.post<ErpDoctypeSchema>("/api/mcp/erp/doctype-fields", input),

  erp_run_method: <T = unknown>(input: ErpRunMethodRequest) =>
    api.post<T>("/api/mcp/erp/run-method", input),
};
