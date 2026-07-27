const API_BASE = import.meta.env.VITE_BACKEND_URL || "";
const TOKEN_KEY = "lst_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) return { error: { message: json?.error?.message || "Sign-in failed" } };
      setStoredToken(json.data.token);
      return { error: null };
    } catch {
      return { error: { message: "Could not reach the server" } };
    }
  },
};

export async function signOut(): Promise<void> {
  clearStoredToken();
}
