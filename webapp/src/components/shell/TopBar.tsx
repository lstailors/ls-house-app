import { useNavigate } from "react-router-dom";
import { Bell, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/authClient";
import { useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@/lib/types";
import { initials } from "@/lib/format";
import { LocationBanner } from "./LocationBanner";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_manager: "Store Manager",
  salesperson: "Salesperson",
  driver: "Driver",
};

interface Props {
  user: Profile;
  onMenuClick?: () => void;
}

export function TopBar({ user, onMenuClick }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleSignOut = async () => {
    await signOut();
    qc.clear();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-4 border-b border-brass/15 bg-forest-deep/70 backdrop-blur-2xl px-3 sm:px-4 md:px-6">
      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden flex items-center justify-center h-11 w-11 -ml-1 rounded-md border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5 text-cream-muted" />
      </button>
      <LocationBanner user={user} />
      <div className="relative ml-2 hidden md:flex flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim" />
        <Input
          placeholder="Search customers, orders, fabrics…"
          className="pl-9 bg-forest-raised/40 border-brass/20 focus-visible:ring-brass/40 focus-visible:ring-offset-0 text-cream placeholder:text-cream-dim/60"
        />
      </div>
      <div className="flex-1 md:hidden" />
      <button className="relative h-11 w-11 sm:h-9 sm:w-9 rounded-full border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors flex items-center justify-center">
        <Bell className="h-4 w-4 text-cream-muted" />
        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-signal-amber" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-3 pr-1 pl-1 rounded-full border border-brass/20 hover:border-brass/40 transition-colors min-h-11">
            <Avatar className="h-8 w-8 border border-brass/30">
              <AvatarImage src={user.image ?? undefined} />
              <AvatarFallback className="bg-forest-raised text-brass-light text-xs font-medium">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block pr-3 text-left leading-tight">
              <div className="text-xs text-cream">{user.name}</div>
              <div className="ui-label text-[9px] mt-0.5">{ROLE_LABEL[user.role]}</div>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[12rem] bg-forest-raised/95 backdrop-blur-xl border-brass/25"
        >
          <DropdownMenuLabel className="text-cream">
            <div className="text-sm">{user.name}</div>
            <div className="ui-label text-[9px] mt-0.5">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-brass/15" />
          <DropdownMenuItem
            onClick={() => navigate("/settings")}
            className="text-cream-muted focus:bg-brass/10 focus:text-cream"
          >
            <UserRound className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigate("/settings")}
            className="text-cream-muted focus:bg-brass/10 focus:text-cream"
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-brass/15" />
          <DropdownMenuItem
            onClick={handleSignOut}
            className="text-signal-rose focus:bg-signal-rose/10 focus:text-signal-rose"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
