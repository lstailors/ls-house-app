/**
 * Type-ahead address search. Uses /api/places (Google when the key is set,
 * otherwise OpenStreetMap). Manual typing always still works.
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
};

export default function AddressAutocomplete({
  value,
  onChange,
  onPick,
  className,
  inputClassName,
  placeholder = "Start typing a street…",
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
        const list = await api.get<Suggestion[]>(
          `/api/places/autocomplete?q=${encodeURIComponent(query)}&near=NYC`,
        );
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : [];
        setItems(rows);
        setOpen(rows.length > 0);
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
  }, [q]);

  function choose(s: Suggestion) {
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
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <input
        className={
          inputClassName ||
          "w-full min-h-11 rounded-xl bg-black/35 border border-brass/25 px-3 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim"
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
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {loading ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-cream-dim">…</span>
      ) : null}
      {open && items.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-brass/30 bg-forest-deep shadow-xl"
        >
          {items.map((s) => (
            <li key={s.id} role="option">
              <button
                type="button"
                className="w-full min-h-11 px-3 py-2.5 text-left text-sm text-cream hover:bg-brass/15 border-b border-white/5 last:border-0"
                onClick={() => choose(s)}
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
