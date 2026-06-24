#!/usr/bin/env bun
/**
 * L&S House ERPNext MCP sidecar.
 *
 * This package lives in the monorepo and talks to the app's internal
 * /api/mcp ERP tool surface. It can be deployed beside the web app or run as a
 * stdio MCP process with:
 *
 *   LST_BACKEND_URL=https://app.lstailors.com MCP_SHARED_SECRET=... bun run start
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.LST_BACKEND_URL ?? process.env.BACKEND_URL ?? "https://app.lstailors.com").replace(/\/+$/, "");
const SECRET = process.env.MCP_SHARED_SECRET ?? process.env.LST_MCP_SECRET ?? "";

if (!SECRET) {
  process.stderr.write("[erp-mcp] WARNING: MCP_SHARED_SECRET/LST_MCP_SECRET is not set\n");
}

const ErpFilter = z.array(z.unknown()).min(3);

async function callInternal<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { "X-MCP-Key": SECRET } : {}),
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({})) as any;
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json.data as T;
}

function text(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const server = new McpServer({
  name: "ls-house-erp-mcp",
  version: "1.0.0",
});

server.tool("erp_ping", "Check ERPNext connectivity through the app-hosted MCP layer.", {}, async () => {
  return text(await callInternal("/api/mcp/ping"));
});

server.tool(
  "erp_list",
  "List ERPNext documents via /api/resource/{DocType}. Supports filters, fields, pagination, and order_by.",
  {
    doctype: z.string().min(1),
    filters: z.array(ErpFilter).optional(),
    fields: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    limit_page_length: z.number().int().min(1).max(1000).optional(),
    limit_start: z.number().int().min(0).optional(),
    order_by: z.string().optional(),
  },
  async (input) => text(await callInternal("/api/mcp/erp/list", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_get",
  "Get one ERPNext document by DocType and name via /api/resource/{DocType}/{name}.",
  {
    doctype: z.string().min(1),
    name: z.string().min(1),
  },
  async (input) => text(await callInternal("/api/mcp/erp/get", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_create",
  "Create an ERPNext document via /api/resource/{DocType}.",
  {
    doctype: z.string().min(1),
    doc: z.record(z.string(), z.unknown()),
  },
  async (input) => text(await callInternal("/api/mcp/erp/create", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_update",
  "Update an ERPNext document via /api/resource/{DocType}/{name}.",
  {
    doctype: z.string().min(1),
    name: z.string().min(1),
    doc: z.record(z.string(), z.unknown()),
  },
  async (input) => text(await callInternal("/api/mcp/erp/update", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_count",
  "Count ERPNext documents for a DocType, optionally with filters.",
  {
    doctype: z.string().min(1),
    filters: z.array(ErpFilter).optional(),
  },
  async (input) => text(await callInternal("/api/mcp/erp/count", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_doctype_fields",
  "Fetch live ERPNext DocType field metadata for schema-aware forms.",
  {
    doctype: z.string().min(1),
  },
  async (input) => text(await callInternal("/api/mcp/erp/doctype-fields", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.tool(
  "erp_run_method",
  "Run an ERPNext backend method through /api/method/{method}.",
  {
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  },
  async (input) => text(await callInternal("/api/mcp/erp/run-method", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[erp-mcp] Connected\n");
