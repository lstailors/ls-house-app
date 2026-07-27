import { useMemo, useState } from "react";
import { Users, Plus, Shield, UserCheck, UserX, Pencil } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { DataTable, type Column } from "@ls/design";
import { FilterBar } from "@ls/design";
import { StatusPill } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@ls/design/ui/avatar";
import {
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useResetUserPassword,
  useLocations,
} from "@/lib/queries";
import { initials } from "@ls/design/format";
import type { Profile } from "@ls/types";
import { toast } from "sonner";

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

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "store_manager", label: "Store Manager" },
  { value: "salesperson", label: "Salesperson" },
  { value: "driver", label: "Driver" },
];

const INPUT_CLS =
  "w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50";

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("salesperson");
  const [locationId, setLocationId] = useState("");

  const { data: locations = [] } = useLocations();
  const createUser = useCreateUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error("Name, email, and password are required.");
      return;
    }
    try {
      await createUser.mutateAsync({
        name,
        email,
        password,
        role,
        locationId: locationId || undefined,
      });
      toast.success("User invited.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to invite user.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-md">
        <h2 className="display-heading text-xl text-cream mb-4">Invite User</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="ui-label block mb-1.5">Full Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLS}
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLS}
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLS}
              placeholder="Min. 8 characters"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={INPUT_CLS}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label block mb-1.5">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="btn-brass" disabled={createUser.isPending}>
              {createUser.isPending ? "Inviting…" : "Invite"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="border-brass/20 text-cream-muted">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [locationId, setLocationId] = useState(user.locationId ?? "");
  const [isActive, setIsActive] = useState(user.isActive);

  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: locations = [] } = useLocations();
  const updateUser = useUpdateUser(user.id);
  const resetPassword = useResetUserPassword(user.id);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateUser.mutateAsync({
        name,
        role,
        locationId: locationId || undefined,
        isActive,
      });
      toast.success("User updated.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update user.");
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    try {
      await resetPassword.mutateAsync(newPassword);
      toast.success("Password reset.");
      setNewPassword("");
      setConfirmPassword("");
      setShowReset(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to reset password.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-md">
        <h2 className="display-heading text-xl text-cream mb-4">Edit User</h2>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="ui-label block mb-1.5">Full Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={INPUT_CLS}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label block mb-1.5">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="ui-label">Active</label>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`w-10 h-6 rounded-full border transition-colors ${
                isActive ? "bg-brass border-brass/60" : "bg-forest-raised border-brass/20"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-cream mx-1 transition-transform ${
                  isActive ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-xs text-cream-dim">{isActive ? "Active" : "Inactive"}</span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" className="btn-brass" disabled={updateUser.isPending}>
              {updateUser.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowReset(!showReset)}
              className="border-brass/20 text-cream-muted"
            >
              Reset Password
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="border-brass/20 text-cream-muted ml-auto">
              Cancel
            </Button>
          </div>
        </form>

        {showReset && (
          <div className="mt-4 pt-4 border-t border-brass/15 space-y-3">
            <div>
              <label className="ui-label block mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={INPUT_CLS}
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <label className="ui-label block mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={INPUT_CLS}
                placeholder="Repeat new password"
              />
            </div>
            <Button
              className="btn-brass"
              onClick={handleResetPassword}
              disabled={resetPassword.isPending}
            >
              {resetPassword.isPending ? "Resetting…" : "Confirm Reset"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const { data: users = [], isLoading } = useAdminUsers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);

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
    {
      key: "actions",
      header: "",
      cell: (u) => (
        <button
          onClick={() => setEditUser(u)}
          className="p-1.5 rounded-lg hover:bg-brass/10 text-cream-dim hover:text-cream transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
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
          <Button className="btn-brass" onClick={() => setShowInvite(true)}>
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

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {editUser && <EditModal user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}
