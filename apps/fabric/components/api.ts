"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { message: string; code: string } };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login")
      window.location.href = "/login";
    throw new ApiError(j.error?.message ?? "Something went wrong", j.error?.code ?? "unknown", res.status);
  }
  return j.data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => fetch(path, { credentials: "same-origin", signal }).then(handle<T>),
  post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then(handle<T>),
  form: <T>(path: string, form: FormData) =>
    fetch(path, { method: "POST", credentials: "same-origin", body: form }).then(handle<T>),
};

export const usd = (n: number | null | undefined, cents = false) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });

export const yd = (n: number) => `${Number(n.toFixed(2))} yd`;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso.replace(" ", "T"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Downscale a camera photo so it fits the serverless body limit. */
export async function compressImage(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", quality),
    );
  } catch {
    return file;
  }
}
