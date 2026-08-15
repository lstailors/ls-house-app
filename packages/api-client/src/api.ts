import { getStoredToken } from "@ls/auth/authClient";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "";

class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

// Response envelope type - all app routes return { data: T }
interface ApiResponse<T> {
  data: T;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getStoredToken();

  const config: RequestInit = {
    ...options,
    credentials: "include", // send HttpOnly lst_session cookie (SSO)
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      json?.error?.message ||
      (typeof json?.error === "string" ? json.error : null) ||
      json?.message ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, json?.error || json);
  }

  // 1. Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // 2. JSON responses: parse and unwrap { data }
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const json: ApiResponse<T> & { error?: { message?: string } | string } = await response.json();
    const errMsg =
      typeof json?.error === "string" ? json.error : json?.error?.message;
    // Legacy ticket list returned 200 + { data: [], error } when ERPNext failed.
    // Treat that as a load failure so boards never look like an empty day.
    if (errMsg && (json.data == null || (Array.isArray(json.data) && json.data.length === 0))) {
      throw new ApiError(errMsg, response.status, json.error);
    }
    return json.data;
  }

  // 3. Non-JSON: return undefined (caller should use api.raw() for these)
  return undefined as T;
}

// Raw request for non-JSON endpoints (uploads, downloads, streams)
async function rawRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getStoredToken();

  const config: RequestInit = {
    ...options,
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };
  return fetch(url, config);
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),

  // Escape hatch for non-JSON endpoints
  raw: rawRequest,
};

// Sample endpoint types (extend as needed)
export interface SampleResponse {
  message: string;
  timestamp: string;
}

// Sample API functions
export const sampleApi = {
  getSample: () => api.get<SampleResponse>("/api/sample"),
};

export { ApiError };
