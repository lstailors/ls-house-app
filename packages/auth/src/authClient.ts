const API_BASE = import.meta.env.VITE_BACKEND_URL || "";
const TOKEN_KEY = "lst_token";

/**
 * Session model (HER-15 / Stage 1):
 * - Primary: HttpOnly cookie `lst_session` on `.lstailors.com` (set by POST /api/auth/login)
 * - Transition dual-write: still stash JWT in localStorage so Bearer headers work for
 *   any caller that hasn't switched to credentials:include yet
 * - All fetches that hit the API must use credentials: "include"
 */

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode / blocked storage — cookie session still works */
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export const signIn = {
  email: async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<{ error?: { message: string } | null }> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) return { error: { message: json?.error?.message || "Sign-in failed" } };
      // Dual-write: cookie is already Set-Cookie'd; keep localStorage for Bearer fallback
      if (json?.data?.token) setStoredToken(json.data.token);
      return { error: null };
    } catch {
      return { error: { message: "Could not reach the server" } };
    }
  },
};

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* still clear local state */
  }
  clearStoredToken();
}

/** Extend the 8h session; safe to call on app focus / interval. */
export async function refreshSession(): Promise<boolean> {
  try {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    if (json?.data?.token) setStoredToken(json.data.token);
    return true;
  } catch {
    return false;
  }
}
