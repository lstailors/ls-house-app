"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, compressImage } from "./api";

export function SaveQuoteSheet({
  payload,
  summary,
  onClose,
}: {
  payload: Record<string, unknown>;
  summary: string;
  onClose: () => void;
}) {
  const [endCustomer, setEndCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; warning?: string } | null>(null);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("payload", JSON.stringify({ ...payload, end_customer: endCustomer, notes }));
      if (photo) form.append("photo", await compressImage(photo), "swatch.jpg");
      setSaved(await api.form<{ name: string; warning?: string }>("/api/quotes", form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="glass-strong w-full max-w-md rounded-b-none p-5 pb-[max(env(safe-area-inset-bottom),20px)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {saved ? (
          <div className="space-y-4 text-center">
            <div className="font-display text-3xl italic">Quote saved</div>
            <div className="text-sm text-cream-dim">{saved.name}</div>
            {saved.warning && <p className="chip mx-auto">{saved.warning}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={onClose}>
                Keep estimating
              </button>
              <Link className="btn-brass" href={`/quotes/${encodeURIComponent(saved.name)}`}>
                View quote
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <div className="font-display text-2xl italic">Save quote</div>
              <div className="text-xs text-cream-dim">{summary}</div>
            </div>
            <label className="block space-y-1.5">
              <span className="label">Client name</span>
              <input className="field" value={endCustomer} onChange={(e) => setEndCustomer(e.target.value)} required autoFocus />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Note (optional)</span>
              <textarea className="field min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-brass/30 p-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-forest-deep/60 text-2xl">📷</span>
              )}
              <span className="text-sm text-cream-muted">{photo ? "Retake swatch photo" : "Add swatch photo (optional)"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
            {error && <p className="rounded-xl bg-signal-rose/10 px-3 py-2 text-sm text-signal-rose">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-brass" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
