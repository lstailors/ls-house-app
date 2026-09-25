"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";

export default function LoginPage() {
  const router = useRouter();
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { usr, pwd });
      router.replace("/estimate");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="glass-strong w-full max-w-sm space-y-5 p-7">
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ls-logo-mark-256.png" alt="L&S Custom Tailors" className="h-20 w-20 rounded-full shadow-glass" />
          <div>
            <h1 className="font-display text-3xl italic">Fabric Estimator</h1>
            <p className="mt-1 text-xs text-cream-dim">L&amp;S Custom Tailors · Trade accounts</p>
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="label">Email</span>
          <input
            className="field"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={usr}
            onChange={(e) => setUsr(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="label">Password</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            required
          />
        </label>
        {error && <p className="rounded-xl bg-signal-rose/10 px-3 py-2 text-sm text-signal-rose">{error}</p>}
        <button className="btn-brass w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
