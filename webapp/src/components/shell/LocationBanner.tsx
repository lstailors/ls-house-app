import { MapPin, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveLocation } from "@/lib/locationContext";
import { useLocations } from "@/lib/queries";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  user: Profile;
}

export function LocationBanner({ user }: Props) {
  const { activeLocationId, setActiveLocationId } = useActiveLocation();
  const { data: locations } = useLocations();

  const isSuperAdmin = user.role === "super_admin";
  const userLocation = locations?.find((l) => l.id === user.locationId);
  const activeLocation = activeLocationId
    ? locations?.find((l) => l.id === activeLocationId)
    : null;

  const displayName = isSuperAdmin
    ? activeLocation?.name ?? "All Locations"
    : userLocation?.name ?? "—";

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-2 rounded-full border border-brass/25 bg-forest-raised/50 backdrop-blur-xl">
        <div className="h-2 w-2 rounded-full bg-signal-emerald shadow-[0_0_8px_rgba(79,191,142,0.7)]" />
        <MapPin className="h-3.5 w-3.5 text-brass-light" />
        <span className="font-display italic text-base tracking-wide text-cream">
          {displayName.toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group flex items-center gap-2.5 px-4 py-2 rounded-full",
            "border border-brass/25 hover:border-brass/50 bg-forest-raised/50 backdrop-blur-xl",
            "transition-all hover:shadow-brass-glow",
          )}
        >
          <div className="h-2 w-2 rounded-full bg-signal-emerald shadow-[0_0_8px_rgba(79,191,142,0.7)]" />
          <MapPin className="h-3.5 w-3.5 text-brass-light" />
          <span className="font-display italic text-base tracking-wide text-cream">
            {displayName.toUpperCase()}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-cream-dim group-hover:text-brass-light transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[14rem] bg-forest-raised/95 backdrop-blur-xl border-brass/25"
      >
        <DropdownMenuLabel className="ui-label">View as</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-brass/15" />
        <DropdownMenuItem
          onClick={() => setActiveLocationId(null)}
          className="font-display italic text-base tracking-wide text-cream focus:bg-brass/10 focus:text-cream"
        >
          All Locations
          {activeLocationId === null ? (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brass-light" />
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-brass/10" />
        {locations?.map((loc) => (
          <DropdownMenuItem
            key={loc.id}
            onClick={() => setActiveLocationId(loc.id)}
            className="font-display italic text-base tracking-wide text-cream focus:bg-brass/10 focus:text-cream"
          >
            {loc.name}
            {activeLocationId === loc.id ? (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brass-light" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
