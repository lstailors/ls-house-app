const MCP_SECRET = process.env.LST_MCP_SECRET ?? "";

type McpTool =
  | "erp_list"
  | "erp_get"
  | "erp_create"
  | "erp_update"
  | "erp_count"
  | "erp_doctype_fields"
  | "erp_run_method"
  | "erp_ping";

const TOOL_ENDPOINT: Record<McpTool, { method: "GET" | "POST"; path: string }> = {
  erp_ping: { method: "GET", path: "/api/mcp/ping" },
  erp_list: { method: "POST", path: "/api/mcp/erp/list" },
  erp_get: { method: "POST", path: "/api/mcp/erp/get" },
  erp_create: { method: "POST", path: "/api/mcp/erp/create" },
  erp_update: { method: "POST", path: "/api/mcp/erp/update" },
  erp_count: { method: "POST", path: "/api/mcp/erp/count" },
  erp_doctype_fields: { method: "POST", path: "/api/mcp/erp/doctype-fields" },
  erp_run_method: { method: "POST", path: "/api/mcp/erp/run-method" },
};

function baseUrl(): string {
  if (process.env.LST_BACKEND_URL) return process.env.LST_BACKEND_URL.replace(/\/+$/, "");
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://app.lstailors.com";
}

export async function callErpMcp<T = unknown>(tool: McpTool, input?: unknown): Promise<T> {
  const endpoint = TOOL_ENDPOINT[tool];
  const res = await fetch(`${baseUrl()}${endpoint.path}`, {
    method: endpoint.method,
    headers: {
      "Content-Type": "application/json",
      ...(MCP_SECRET ? { "X-MCP-Key": MCP_SECRET } : {}),
    },
    body: endpoint.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `MCP ${tool} failed with ${res.status}`);
  return json.data as T;
}

export const erpMcp = {
  erp_ping: () => callErpMcp("erp_ping"),
  erp_list: <T = unknown>(input: unknown) => callErpMcp<T[]>("erp_list", input),
  erp_get: <T = unknown>(input: unknown) => callErpMcp<T>("erp_get", input),
  erp_create: <T = unknown>(input: unknown) => callErpMcp<T>("erp_create", input),
  erp_update: <T = unknown>(input: unknown) => callErpMcp<T>("erp_update", input),
  erp_count: (input: unknown) => callErpMcp<number>("erp_count", input),
  erp_doctype_fields: <T = unknown>(input: unknown) => callErpMcp<T>("erp_doctype_fields", input),
  erp_run_method: <T = unknown>(input: unknown) => callErpMcp<T>("erp_run_method", input),
};
