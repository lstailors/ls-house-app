import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, Send, AlertTriangle, Clock,
  Mail, ChevronDown, Headphones, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { Textarea } from "@ls/design/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@ls/design/ui/dropdown-menu";
import {
  useHelpdeskTicket, useHelpdeskReply, useHelpdeskUpdateStatus,
} from "@/lib/queries";
import { useMe } from "@/lib/session";
import { cn } from "@ls/design/utils";
import type { HDCommunication } from "@ls/types";

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  Open:            "bg-signal-amber/15 text-signal-amber border-signal-amber/30",
  Replied:         "bg-sky-500/15 text-sky-400 border-sky-500/25",
  Resolved:        "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  Closed:          "bg-cream-dim/15 text-cream-dim border-cream-dim/20",
  "Waiting on YZ": "bg-purple-500/15 text-purple-400 border-purple-500/25",
};

const PRIORITY_COLOR: Record<string, string> = {
  Urgent: "text-signal-rose",
  High:   "text-signal-amber",
  Medium: "text-brass-light",
  Low:    "text-cream-dim",
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  Open:            ["Replied", "Resolved", "Closed", "Waiting on YZ"],
  Replied:         ["Open", "Resolved", "Closed", "Waiting on YZ"],
  "Waiting on YZ": ["Open", "Replied", "Resolved", "Closed"],
  Resolved:        ["Open", "Closed"],
  Closed:          ["Open"],
};

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function shortEmail(email: string | null) {
  if (!email) return "—";
  return email.split("@")[0];
}

// ── Communication bubble ──────────────────────────────────────────────────

function CommBubble({ comm }: { comm: HDCommunication }) {
  const isSent = comm.sentOrReceived === "Sent";
  return (
    <div className={cn("flex gap-3", isSent ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar dot */}
      <div className={cn(
        "h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5",
        isSent ? "bg-brass/25 text-brass-light" : "bg-forest-deep/80 text-cream-dim border border-brass/20"
      )}>
        {(comm.senderName ?? comm.sender ?? "?").charAt(0).toUpperCase()}
      </div>
      <div className={cn("max-w-[80%] space-y-1", isSent ? "items-end" : "items-start")}>
        <div className={cn("text-[10px] text-cream-dim flex items-center gap-1.5", isSent && "flex-row-reverse")}>
          <span className="font-medium text-cream-muted">
            {comm.senderName ?? shortEmail(comm.sender)}
          </span>
          <span>·</span>
          <span>{formatTs(comm.creation)}</span>
          {isSent ? (
            <Mail className="h-3 w-3 text-brass/60" />
          ) : null}
        </div>
        <div className={cn(
          "rounded-xl px-4 py-3 text-sm leading-relaxed",
          isSent
            ? "bg-brass/15 border border-brass/25 text-cream"
            : "bg-forest-deep/60 border border-brass/12 text-cream-muted"
        )}>
          {/* Render plain text — strip HTML for safety */}
          <p className="whitespace-pre-wrap break-words">{stripHtml(comm.content)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function HelpdeskTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [reply, setReply] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const { data: ticket, isLoading, refetch, isFetching } = useHelpdeskTicket(id);
  const replyMutation = useHelpdeskReply(id ?? "");
  const statusMutation = useHelpdeskUpdateStatus(id ?? "");

  // Scroll thread to bottom when new communications arrive
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [ticket?.communications.length]);

  const isMgr = me?.role === "super_admin" || me?.role === "store_manager";

  const handleReply = async () => {
    if (!reply.trim()) return;
    try {
      await replyMutation.mutateAsync(reply.trim());
      setReply("");
      toast.success("Reply sent");
    } catch {
      toast.error("Failed to send reply");
    }
  };

  const handleStatusChange = async (status: string) => {
    try {
      await statusMutation.mutateAsync(status);
      toast.success(`Status → ${status}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="h-5 w-5 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/helpdesk")} className="text-cream-dim hover:text-cream">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Helpdesk
        </Button>
        <GlassCard className="p-8 text-center text-cream-dim">Ticket not found.</GlassCard>
      </div>
    );
  }

  const availableStatuses = STATUS_TRANSITIONS[ticket.status ?? "Open"] ?? ["Open", "Resolved", "Closed"];

  return (
    <div className="space-y-4 md:space-y-6 max-w-3xl mx-auto">
      {/* Back */}
      <Button
        variant="ghost"
        onClick={() => navigate("/helpdesk")}
        className="text-cream-dim hover:text-cream -ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Helpdesk
      </Button>

      {/* Ticket header */}
      <GlassCard className="p-5 md:p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-brass/15 border border-brass/25 flex items-center justify-center shrink-0">
            <Headphones className="h-5 w-5 text-brass-light" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="ui-label text-[9px] text-brass-light">{ticket.name}</span>
              {ticket.escalate && (
                <span className="flex items-center gap-1 text-[10px] text-signal-rose font-medium">
                  <AlertTriangle className="h-3 w-3" /> Escalated
                </span>
              )}
            </div>
            <h1 className="text-cream text-lg md:text-xl font-medium leading-snug">
              {ticket.subject ?? ticket.name}
            </h1>
          </div>
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-5">
          <div>
            <div className="ui-label text-[9px] mb-1">Status</div>
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", STATUS_COLOR[ticket.status ?? ""] ?? "bg-cream-dim/15 text-cream-dim border-cream-dim/20")}>
              {ticket.status ?? "—"}
            </span>
          </div>
          <div>
            <div className="ui-label text-[9px] mb-1">Priority</div>
            <span className={cn("font-medium", PRIORITY_COLOR[ticket.priority ?? ""] ?? "text-cream-dim")}>
              {ticket.priority ?? "—"}
            </span>
          </div>
          <div>
            <div className="ui-label text-[9px] mb-1">Team</div>
            <span className="text-cream-muted">{ticket.agentGroup ?? "—"}</span>
          </div>
          <div>
            <div className="ui-label text-[9px] mb-1">Age</div>
            <span className="flex items-center gap-1 text-cream-muted">
              <Clock className="h-3 w-3 text-cream-dim" />
              {ticket.daysOpen === 0 ? "Today" : `${ticket.daysOpen}d open`}
            </span>
          </div>
          {ticket.orderId && (
            <div>
              <div className="ui-label text-[9px] mb-1">Linked Order</div>
              <span className="text-brass-light font-medium">{ticket.orderId}</span>
            </div>
          )}
          {ticket.assignees.length > 0 && (
            <div>
              <div className="ui-label text-[9px] mb-1">Assigned</div>
              <span className="text-cream-muted">{ticket.assignees.map(shortEmail).join(", ")}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {isMgr && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={statusMutation.isPending}
                  className="border-brass/25 text-cream-muted hover:text-cream hover:border-brass/40 bg-transparent"
                >
                  {statusMutation.isPending ? "Updating…" : "Change Status"}
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-forest-raised/97 border-brass/25 backdrop-blur-xl">
                {availableStatuses.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className="text-cream-muted focus:bg-brass/10 focus:text-cream cursor-pointer"
                  >
                    {s}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-cream-dim hover:text-brass-light transition-colors border border-brass/15 hover:border-brass/30 px-3 py-1.5 rounded-md"
          >
            <ExternalLink className="h-3 w-3" /> Open in ERP
          </a>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors ml-auto"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} /> Refresh
          </button>
        </div>
      </GlassCard>

      {/* Description */}
      {ticket.description && (
        <GlassCard className="p-5">
          <div className="ui-label text-[9px] mb-2">Description</div>
          <p className="text-cream-muted text-sm leading-relaxed whitespace-pre-wrap">
            {stripHtml(ticket.description)}
          </p>
        </GlassCard>
      )}

      {/* Thread */}
      <GlassCard className="overflow-hidden">
        <div className="px-5 py-3 border-b border-brass/10 bg-forest-deep/30 flex items-center justify-between">
          <span className="ui-label text-[9px]">
            Conversation · {ticket.communications.length} message{ticket.communications.length !== 1 ? "s" : ""}
          </span>
        </div>

        {ticket.communications.length === 0 ? (
          <div className="px-5 py-10 text-center text-cream-dim text-sm">
            No messages yet. Send the first reply below.
          </div>
        ) : (
          <div
            ref={threadRef}
            className="px-5 py-4 space-y-5 max-h-[480px] overflow-y-auto"
          >
            {ticket.communications.map((comm) => (
              <CommBubble key={comm.name} comm={comm} />
            ))}
          </div>
        )}

        {/* Reply box */}
        <div className="px-5 py-4 border-t border-brass/12 bg-forest-deep/20 space-y-3">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply… (will send via ERPNext and email maestro@lstailors.com)"
            rows={3}
            className="bg-forest-deep/60 border-brass/20 text-cream placeholder:text-cream-dim/50 resize-none text-sm"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleReply();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-cream-dim">⌘↩ to send</span>
            <Button
              onClick={handleReply}
              disabled={!reply.trim() || replyMutation.isPending}
              size="sm"
              className="bg-brass text-forest-deep hover:bg-brass-shimmer font-medium"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {replyMutation.isPending ? "Sending…" : "Send Reply"}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
