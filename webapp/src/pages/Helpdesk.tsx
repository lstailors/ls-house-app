import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Headphones, Plus, AlertTriangle, Clock, CheckCircle2,
  ChevronRight, ExternalLink, Filter, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { KpiCard } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { Badge } from "@ls/design/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@ls/design/ui/dialog";
import { Input } from "@ls/design/ui/input";
import { Textarea } from "@ls/design/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@ls/design/ui/select";
import {
  useHelpdeskTickets, useHelpdeskOpenCount, useHelpdeskCreateTicket,
} from "@/lib/queries";
import { useMe } from "@/lib/session";
import { cn } from "@ls/design/utils";
import type { HDTicket } from "@ls/types";

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  Open:           "bg-signal-amber/15 text-signal-amber border-signal-amber/30",
  Replied:        "bg-sky-500/15 text-sky-400 border-sky-500/25",
  Resolved:       "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  Closed:         "bg-cream-dim/15 text-cream-dim border-cream-dim/20",
  "Waiting on YZ": "bg-purple-500/15 text-purple-400 border-purple-500/25",
};

const PRIORITY_DOT: Record<string, string> = {
  Urgent: "bg-signal-rose",
  High:   "bg-signal-amber",
  Medium: "bg-brass/60",
  Low:    "bg-cream-dim/40",
};

function statusColor(s: string | null) {
  return STATUS_COLOR[s ?? ""] ?? "bg-cream-dim/15 text-cream-dim border-cream-dim/20";
}

function shortEmail(email: string) {
  return email.split("@")[0];
}

function daysLabel(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "1d";
  return `${n}d`;
}

// ── New ticket dialog ─────────────────────────────────────────────────────

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const create = useHelpdeskCreateTicket();

  const handleSubmit = async () => {
    if (!subject.trim()) { toast.error("Subject is required"); return; }
    try {
      await create.mutateAsync({ subject: subject.trim(), description: description.trim(), priority });
      toast.success("Ticket created");
      setSubject(""); setDescription(""); setPriority("Medium");
      onClose();
    } catch {
      toast.error("Failed to create ticket");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-forest-raised/97 border-brass/25 backdrop-blur-xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-cream font-display italic text-xl">New Helpdesk Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="ui-label text-[10px] mb-1.5 block">Subject *</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief description of the issue…"
              className="bg-forest-deep/60 border-brass/20 text-cream placeholder:text-cream-dim/50"
            />
          </div>
          <div>
            <label className="ui-label text-[10px] mb-1.5 block">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional details, order numbers, context…"
              rows={4}
              className="bg-forest-deep/60 border-brass/20 text-cream placeholder:text-cream-dim/50 resize-none"
            />
          </div>
          <div>
            <label className="ui-label text-[10px] mb-1.5 block">Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="bg-forest-deep/60 border-brass/20 text-cream">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-forest-raised border-brass/25">
                {["Low", "Medium", "High", "Urgent"].map((p) => (
                  <SelectItem key={p} value={p} className="text-cream focus:bg-brass/10">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-cream-dim hover:text-cream">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={create.isPending}
            className="bg-brass text-forest-deep hover:bg-brass-shimmer font-medium"
          >
            {create.isPending ? "Creating…" : "Create Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ticket row ────────────────────────────────────────────────────────────

function TicketRow({ ticket }: { ticket: HDTicket }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/helpdesk/${ticket.name}`)}
      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-brass/5 transition-colors border-b border-brass/8 last:border-0 text-left group"
    >
      {/* Priority dot */}
      <div className={cn("h-2 w-2 rounded-full shrink-0 mt-0.5", PRIORITY_DOT[ticket.priority ?? ""] ?? "bg-cream-dim/40")} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-cream text-sm font-medium leading-snug truncate max-w-[300px] md:max-w-none">
            {ticket.subject ?? ticket.name}
          </span>
          {ticket.escalate && (
            <span className="flex items-center gap-1 text-[10px] text-signal-rose font-medium">
              <AlertTriangle className="h-3 w-3" /> Escalated
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="ui-label text-[9px] text-brass-light">{ticket.name}</span>
          {ticket.orderId && (
            <span className="ui-label text-[9px] text-cream-dim">Order: {ticket.orderId}</span>
          )}
          {ticket.assignees.length > 0 && (
            <span className="text-[10px] text-cream-dim">
              → {ticket.assignees.map(shortEmail).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Status + age */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", statusColor(ticket.status))}>
          {ticket.status}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-[10px] text-cream-dim">
          <Clock className="h-3 w-3" /> {daysLabel(ticket.daysOpen)}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-cream-dim opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "Open", "Replied", "Waiting on YZ", "Resolved", "Closed"];

export default function Helpdesk() {
  const { data: me } = useMe();
  const [statusFilter, setStatusFilter] = useState("all");
  const [mine, setMine] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const isMgr = me?.role === "super_admin" || me?.role === "store_manager";

  const { data: tickets = [], isLoading, refetch, isFetching } = useHelpdeskTickets({
    status: statusFilter === "all" ? undefined : statusFilter,
    mine: !isMgr ? true : mine,
  });

  const { data: counts } = useHelpdeskOpenCount();

  const open   = tickets.filter((t) => t.status !== "Closed" && t.status !== "Resolved").length;
  const escalated = tickets.filter((t) => t.escalate).length;
  const resolved  = tickets.filter((t) => t.status === "Resolved" || t.status === "Closed").length;

  return (
    <div className="space-y-6 md:space-y-8">
      <SectionHeader
        eyebrow="Support Operations"
        title={<>Helpdesk</>}
        description="ERPNext HD Tickets — unified support view for the L&S team."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-cream-dim hover:text-cream border border-brass/20"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setNewOpen(true)}
              className="bg-brass text-forest-deep hover:bg-brass-shimmer font-medium"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Ticket
            </Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <KpiCard
          label="Open Tickets"
          value={counts?.total ?? open}
          icon={<Headphones className="h-4 w-4" />}
          accent={(counts?.total ?? open) > 0 ? "amber" : "default"}
        />
        <KpiCard
          label="Escalated"
          value={counts?.escalated ?? escalated}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent={escalated > 0 ? "rose" : "default"}
        />
        <KpiCard
          label="Resolved / Closed"
          value={resolved}
          icon={<CheckCircle2 className="h-4 w-4" />}
          className="col-span-2 md:col-span-1"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-cream-dim shrink-0" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-full border transition-colors",
              statusFilter === s
                ? "bg-brass/20 border-brass/40 text-brass-light font-medium"
                : "border-brass/15 text-cream-dim hover:border-brass/30 hover:text-cream"
            )}
          >
            {s === "all" ? "All Statuses" : s}
          </button>
        ))}
        {isMgr && (
          <button
            onClick={() => setMine((v) => !v)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-full border transition-colors ml-auto",
              mine
                ? "bg-brass/20 border-brass/40 text-brass-light font-medium"
                : "border-brass/15 text-cream-dim hover:border-brass/30 hover:text-cream"
            )}
          >
            Mine only
          </button>
        )}
      </div>

      {/* Ticket list */}
      <GlassCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={Headphones}
            title="No tickets found"
            description={statusFilter !== "all" ? `No ${statusFilter} tickets.` : "All clear — no open tickets."}
          />
        ) : (
          <div>
            <div className="px-4 py-2.5 border-b border-brass/10 bg-forest-deep/30 flex items-center justify-between">
              <span className="ui-label text-[9px]">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</span>
              <a
                href="https://erp.lstailors.com/helpdesk"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-cream-dim hover:text-brass-light transition-colors"
              >
                Open in ERPNext <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {tickets.map((t) => <TicketRow key={t.name} ticket={t} />)}
          </div>
        )}
      </GlassCard>

      <NewTicketDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
