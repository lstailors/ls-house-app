import { cn } from "@ls/design/utils";
import { Search } from "lucide-react";

const PLACEHOLDER = "Search tickets, clients, deliveries…";

/** One search field. Pages pass a hint for what this view filters. */
export function AltsSearchField({
  value,
  onChange,
  scope,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Short scope, e.g. "this board" — appended after the shared phrase. */
  scope?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const placeholder = scope ? `${PLACEHOLDER} (${scope})` : PLACEHOLDER;
  return (
    <label className={cn("relative block min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brass-light" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full h-12 rounded-full bg-black/30 border border-brass/25 pl-10 pr-4 text-base sm:text-sm text-cream placeholder:text-cream-dim outline-none focus:border-brass/50"
      />
    </label>
  );
}

export const ALTS_SEARCH_PLACEHOLDER = PLACEHOLDER;
