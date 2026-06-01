import { User, Phone, Mail, Star } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Customer } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface CustomerDraft {
  name: string;
  phone: string;
  email: string;
}

interface Props {
  value: CustomerDraft;
  onChange: (v: CustomerDraft) => void;
  recentCustomers: Customer[];
}

export function CustomerField({ value, onChange, recentCustomers }: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const q = value.name.toLowerCase();
  const suggestions = q.length >= 2
    ? recentCustomers
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.phone.includes(value.name),
        )
        .slice(0, 4)
    : [];

  const pickExisting = (c: Customer) => {
    onChange({ name: c.name, phone: c.phone, email: c.email ?? "" });
    setShowSuggestions(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-1 relative">
        <Label htmlFor="cust-name" className="ui-label text-[10px] mb-1.5 block">Customer</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
          <Input
            id="cust-name"
            value={value.name}
            onChange={(e) => {
              onChange({ ...value, name: e.target.value });
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Full name"
            className="pl-9 h-12 sm:h-10 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-base sm:text-sm"
          />
        </div>
        {showSuggestions && suggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 left-0 right-0 rounded-lg border border-brass/25 bg-forest-raised/95 backdrop-blur-xl shadow-glass-lg overflow-hidden">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => pickExisting(c)}
                className="w-full flex items-center justify-between px-3 py-3 sm:py-2 text-left hover:bg-brass/10 active:bg-brass/15 transition-colors min-h-[48px] sm:min-h-0"
              >
                <div className="min-w-0">
                  <div className="text-sm text-cream truncate flex items-center gap-1.5">
                    {c.name}
                    {c.dossier?.vip ? <Star className="h-3 w-3 text-brass fill-brass" /> : null}
                  </div>
                  <div className="text-[10px] text-cream-dim truncate">{c.phone}</div>
                </div>
                <div className={cn("text-[9px] uppercase tracking-widerer text-cream-dim")}>
                  Returning
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div>
        <Label htmlFor="cust-phone" className="ui-label text-[10px] mb-1.5 block">Phone</Label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
          <Input
            id="cust-phone"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder="+1 (212) 555-…"
            inputMode="tel"
            className="pl-9 h-12 sm:h-10 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-base sm:text-sm"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="cust-email" className="ui-label text-[10px] mb-1.5 block">
          Email <span className="text-cream-dim/60 normal-case">(optional)</span>
        </Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
          <Input
            id="cust-email"
            type="email"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
            placeholder="name@domain.com"
            inputMode="email"
            className="pl-9 h-12 sm:h-10 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-base sm:text-sm"
          />
        </div>
      </div>
    </div>
  );
}
