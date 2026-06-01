import { useMemo, useState } from "react";
import { Users, Plus, Shield, UserCheck, UserX } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAdminUsers } from "@/lib/queries";
import { initials } from "@/lib/format";
import type { Profile } from "@/lib/types";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "super_admin", label: "Super Admin" },
  { value: "store_manager", label: "Manager" },
  { value: "salesperson", label: "Sales" },
  { value: "driver", label: "Driver" },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_manager: "Store Manager",
  salesperson: "Salesperson",
  driver: "Driver",
};

export default function AdminUsers() {
  const { data: users = [], isLoading } = useAdminUsers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return users.filter((u) => {
      if (filter !== "all" && u.role !== filter) return false;
      if (!s) return true;
      return (
        u.name.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.location?.name ?? "").toLowerCase().includes(s)
      );
    });
  }, [users, search, filter]);

  const activeCount = users.filter((u) => u.isActive).length;
  const adminCount = users.filter((u) => u.role === "super_admin").length;

  const columns: Column<Profile>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-9 w-9 border border-brass/25 shrink-0">
            <AvatarImage src={u.image ?? undefined} />
            <AvatarFallback className="bg-forest-raised text-brass-light text-xs">
              {initials(u.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-cream font-medium truncate">{u.name}</div>
            <div className="text-[11px] text-cream-dim truncate">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-brass/25 bg-brass/10 text-[10px] uppercase tracking-wider text-brass-light">
          <Shield className="h-2.5 w-2.5" /> {ROLE_LABEL[u.role]}
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      cell: (u) => (
        <span className="text-cream-muted text-sm">{u.location?.name ?? "All"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => (
        <StatusPill
          status={u.isActive ? "active" : "inactive"}
          variant={u.isActive ? "emerald" : "muted"}
          label={u.isActive ? "Active" : "Inactive"}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Users"
        title={
          <>
            The <span className="text-brass-shimmer">people</span> of the house.
          </>
        }
        description="Cutters, salespeople, drivers, managers — everyone with a key."
        actions={
          <Button className="btn-brass">
            <Plus className="h-4 w-4 mr-1.5" /> Invite user
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Total
          </div>
          <div className="kpi-number">{users.length}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <UserCheck className="h-3 w-3 text-signal-emerald" /> Active
          </div>
          <div className="kpi-number text-signal-emerald">{activeCount}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-brass-light" /> Super Admins
          </div>
          <div className="kpi-number">{adminCount}</div>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, email, or location"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={FILTERS}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserX}
          title="No users match"
          description="Adjust the filter or invite someone new to the house."
        />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      )}
    </div>
  );
}
