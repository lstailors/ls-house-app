/**
 * Address autocomplete for delivery intake.
 * Uses hub /api/places/autocomplete (Google if GOOGLE_MAPS_API_KEY set,
 * else Photon/OSM). Manual entry always remains available.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";

export type AddressPick = {
  street: string;
  apt?: string;
  city: string;
  state: string;
  zip: string;
  label: string;
};

type Suggestion = {
  id: string;
  label: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
};

type Props = {
  value: string;
  onChange: (street: string) => void;
  onPick: (addr: AddressPick) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  /** ZIP already typed — folded into the geocode so Long Island streets resolve. */
  zip?: string;
};

export default function AddressAutocomplete({
  value,
  onChange,
  onPick,
  className,
  inputClassName,
  placeholder = "213 E 61st St",
  zip,
}: Props) {
  const [q, setQ] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipNext = useRef(false);

  useEffect(() => {
    setQ(value || "");
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const query = q.trim();
    if (query.length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.raw(
          `/api/places/autocomplete?q=${encodeURIComponent(query)}${
            zip ? `&zip=${encodeURIComponent(zip.replace(/\D/g, "").slice(0, 5))}` : ""
          }&near=NYC`,
        );
        const json = (await res.json()) as { data?: Suggestion[] };
        if (cancelled) return;
        const list = Array.isArray(json.data) ? json.data : [];
        setItems(list);
        setOpen(list.length > 0);
      } catch {
        if (!cancelled) {
          setItems([]);
          setOpen(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, zip]);

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <input
        className={
          inputClassName ||
          "mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
        }
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          onChange(v);
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {loading ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-cream-dim">…</span>
      ) : null}
      {open && items.length > 0 ? (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-brass/30 bg-forest-deep shadow-xl">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm text-cream hover:bg-brass/15 border-b border-white/5 last:border-0"
                onClick={() => {
                  skipNext.current = true;
                  const street = s.street || s.label.split(",")[0] || s.label;
                  setQ(street);
                  onChange(street);
                  onPick({
                    street,
                    city: s.city || "New York",
                    state: s.state || "NY",
                    zip: s.zip || "",
                    label: s.label,
                  });
                  setOpen(false);
                  setItems([]);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
