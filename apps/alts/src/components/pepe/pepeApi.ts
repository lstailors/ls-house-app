import { api, ApiError } from "@ls/api-client";

export const PEPE_EMAIL = "pepe@lstailors.com";

export type PepeChatMe = {
  user: { email: string; name: string };
  pepeChannelId: string | null;
};

export type PepeMessage = {
  name: string;
  text: string;
  owner: string;
  creation: string;
  message_type: string;
  file: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  is_bot_message: boolean;
  is_pepe: boolean;
};

export type PepeTodo = {
  name: string;
  description: string;
  status: string;
  priority: string;
  date: string | null;
  allocated_to: string | null;
  reference_type: string | null;
  reference_name: string | null;
};

export { ApiError };

export const pepeApi = {
  me: () => api.get<PepeChatMe>("/api/chat/me"),
  messages: (limit = 50) => api.get<PepeMessage[]>(`/api/chat/messages?limit=${limit}`),
  send: (text: string) => api.post<PepeMessage[]>("/api/chat/messages", { text }),
  todos: () => api.get<PepeTodo[]>("/api/chat/todos"),
  closeTodo: (id: string) => api.post<PepeTodo>(`/api/chat/todos/${encodeURIComponent(id)}/close`),
  upload: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await api.raw("/api/chat/upload", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as
      | { data?: PepeMessage[]; error?: { message?: string } | string }
      | null;
    if (!res.ok) {
      const err = json?.error;
      const message = typeof err === "string" ? err : err?.message || `Upload failed (${res.status})`;
      throw new ApiError(message, res.status, json);
    }
    return json?.data ?? [];
  },
};
