// ─────────────────────────────────────────────────────────────────────────────
// House — static mock data.
// Everything here is placeholder. Live wiring (Hermes API / ERP / Sofia health)
// happens in a follow-up session. Shapes are kept intentionally simple so they
// map cleanly onto real endpoints later.
// ─────────────────────────────────────────────────────────────────────────────

export type AgentStatus = "online" | "idle" | "offline";

export interface HouseAgent {
  slug: string;
  name: string;
  role: string;
  model: string;
  status: AgentStatus;
  lastActive: string;
  pending: number;
  activeTasks: number;
  photo?: string;
  description: string;
  skills: string[];
  activity: { time: string; text: string }[];
  memory: string[];
}

export const AGENTS: HouseAgent[] = [
  {
    slug: "maestro",
    name: "Maestro",
    role: "Orchestrator",
    model: "claude-sonnet-4-6",
    status: "online",
    lastActive: "just now",
    pending: 0,
    activeTasks: 4,
    photo: "/agents/maestro.jpg",
    description:
      "The conductor of the House. Maestro decomposes high-level intent into delegated tasks, spawns sub-agents in parallel, routes approvals to C, and keeps a running memory of the business. Every other agent reports through Maestro.",
    skills: ["ls-house-platform", "hermes-agent", "n8n-workflow-building", "calcom-scheduling", "erpnext-docker"],
    activity: [
      { time: "just now", text: "Spawned 4 sub-agents for morning brief assembly" },
      { time: "8 min ago", text: "Routed overdue-orders approval to C" },
      { time: "26 min ago", text: "Delegated email triage batch to Simone" },
      { time: "1 hour ago", text: "Updated memory: Sicily trip July 2026" },
      { time: "2 hours ago", text: "Completed nightly reconciliation pass" },
    ],
    memory: [
      "C prefers action-first, short updates over iMessage",
      "Square sync runs 6:15 AM — flag failures to C immediately",
      "Sofia owns all client SMS; never double-text a client",
    ],
  },
  {
    slug: "sofia",
    name: "Sofia",
    role: "Client Concierge",
    model: "grok-4.3",
    status: "online",
    lastActive: "2 min ago",
    pending: 3,
    activeTasks: 2,
    photo: "/agents/sofia.jpg",
    description:
      "The voice of the House to clients. Sofia handles inbound and outbound SMS over Twilio, books and confirms appointments, answers fit and status questions, and escalates anything sensitive to C. Warm, precise, never pushy.",
    skills: ["calcom-scheduling", "ls-house-platform", "sofia-docker-setup"],
    activity: [
      { time: "2 min ago", text: "Replied to client +1631 re: Thursday fitting" },
      { time: "18 min ago", text: "Booked appointment — Tue 2:00 PM, Madison Ave" },
      { time: "40 min ago", text: "Confirmed pickup with client +1917" },
      { time: "1 hour ago", text: "Escalated refund request to C" },
      { time: "3 hours ago", text: "Sent 6 fitting reminders for tomorrow" },
    ],
    memory: [
      "Twilio number +1 212 308 4431 is Sofia's line",
      "Never quote firm prices — defer custom pricing to C",
      "VIP clients flagged in ERP get same-day callbacks",
    ],
  },
  {
    slug: "mia",
    name: "Mia",
    role: "Scheduling",
    model: "claude-sonnet-4-5",
    status: "idle",
    lastActive: "1 hour ago",
    pending: 0,
    activeTasks: 0,
    photo: "/agents/mia.jpg",
    description:
      "Owns the calendar. Mia balances fitting rooms across locations, resolves double-bookings, holds buffer time for walk-ins, and syncs Cal.com with the ERP appointment records. She keeps the day runnable.",
    skills: ["calcom-scheduling", "ls-house-platform", "n8n-workflow-building"],
    activity: [
      { time: "1 hour ago", text: "Rebalanced 3 fittings to avoid room clash" },
      { time: "2 hours ago", text: "Held 4–5 PM buffer for Madison Ave walk-ins" },
      { time: "4 hours ago", text: "Synced Cal.com schedule 1415186 with ERP" },
      { time: "yesterday", text: "Flagged over-booked Saturday slot to Maestro" },
      { time: "yesterday", text: "Confirmed tailor availability for next week" },
    ],
    memory: [
      "Cal.com schedule ID 1415186 is the master calendar",
      "Keep 30-min buffers between custom fittings",
      "Madison Ave has 2 rooms; Flatiron has 1",
    ],
  },
  {
    slug: "simone",
    name: "Simone",
    role: "Email Triage",
    model: "claude-sonnet-4-5",
    status: "idle",
    lastActive: "3 hours ago",
    pending: 0,
    activeTasks: 0,
    description:
      "Reads the inbox so C doesn't have to. Simone classifies inbound email, drafts replies for routine threads, surfaces anything urgent, and files the rest. She turns a noisy inbox into a short, ranked list.",
    skills: ["ls-house-platform", "hermes-agent", "n8n-workflow-building"],
    activity: [
      { time: "3 hours ago", text: "Triaged 12 emails — 2 flagged urgent" },
      { time: "5 hours ago", text: "Drafted reply to fabric supplier re: lead time" },
      { time: "yesterday", text: "Filed 9 newsletters, archived 14 receipts" },
      { time: "yesterday", text: "Escalated chargeback notice to C" },
      { time: "2 days ago", text: "Summarized vendor contract thread" },
    ],
    memory: [
      "Supplier emails from milano-textiles are always high priority",
      "Never auto-send replies that quote money — draft only",
      "Chargebacks and legal go straight to C",
    ],
  },
  {
    slug: "la-penna",
    name: "La Penna",
    role: "Copywriting",
    model: "claude-sonnet-4-6",
    status: "offline",
    lastActive: "yesterday",
    pending: 0,
    activeTasks: 0,
    description:
      "The house pen. La Penna writes client-facing copy in the L&S voice — appointment messages, seasonal campaigns, product descriptions, and the occasional handwritten-style note. Elegant, restrained, never salesy.",
    skills: ["ls-house-platform", "hermes-agent"],
    activity: [
      { time: "yesterday", text: "Drafted spring campaign — 3 SMS variants" },
      { time: "yesterday", text: "Rewrote pickup-ready message for warmth" },
      { time: "2 days ago", text: "Wrote 8 fabric descriptions for style library" },
      { time: "3 days ago", text: "Polished holiday thank-you note template" },
      { time: "4 days ago", text: "A/B copy for re-engagement campaign" },
    ],
    memory: [
      "House voice: understated, confident, second-person",
      "Avoid exclamation marks in client copy",
      "Always sign campaigns 'The House of L&S'",
    ],
  },
  {
    slug: "paperclip",
    name: "Paperclip",
    role: "Strategy",
    model: "claude-opus-4",
    status: "idle",
    lastActive: "this morning",
    pending: 0,
    activeTasks: 1,
    description:
      "The deep thinker. Paperclip runs longer analyses — revenue trends, client cohort behavior, capacity planning, and build proposals. Slower and more expensive by design; reserved for decisions that matter.",
    skills: ["ls-house-platform", "hermes-agent", "erpnext-docker", "n8n-workflow-building"],
    activity: [
      { time: "this morning", text: "Drafted Q3 capacity plan across both locations" },
      { time: "yesterday", text: "Analyzed repeat-client lifetime value cohorts" },
      { time: "2 days ago", text: "Proposed pipeline for automated reorder nudges" },
      { time: "3 days ago", text: "Reviewed fabric margin by supplier" },
      { time: "4 days ago", text: "Modeled impact of Saturday hours" },
    ],
    memory: [
      "Use Opus only for analysis C will act on — watch cost",
      "Capacity is the binding constraint, not demand",
      "ERPNext 16 is the source of truth for revenue",
    ],
  },
  {
    slug: "marco",
    name: "Marco",
    role: "Technical",
    model: "claude-sonnet-4-6",
    status: "offline",
    lastActive: "2 days ago",
    pending: 0,
    activeTasks: 0,
    description:
      "Keeps the lights on. Marco watches the stack — Docker services, n8n workflows, the ERP, and Sofia's containers — restarts what falls over, and files an incident note when something needs a human. The House's quiet ops engineer.",
    skills: ["sofia-docker-setup", "erpnext-docker", "n8n-workflow-building", "ls-house-platform"],
    activity: [
      { time: "2 days ago", text: "Restarted sophia-agent container after OOM" },
      { time: "2 days ago", text: "Patched n8n workflow — Square webhook retry" },
      { time: "3 days ago", text: "Verified ERPNext 16 nightly backup" },
      { time: "4 days ago", text: "Rotated Twilio credentials" },
      { time: "5 days ago", text: "Cleaned up stale Docker volumes on host" },
    ],
    memory: [
      "Sofia Docker: sophia-agent, ports 8000 + 8501",
      "ERP at erp.lstailors.com — ERPNext 16",
      "Restart order: db → erp → n8n → sofia",
    ],
  },
];

// ─── Profiles ────────────────────────────────────────────────────────────────

export type ProfileStatus = "active" | "inactive";

export interface HouseProfile {
  id: string;
  name: string;
  isDefault?: boolean;
  model: string;
  provider: string;
  status: ProfileStatus;
  created: string;
}

export const PROFILES: HouseProfile[] = [
  { id: "p-maestro", name: "Maestro", isDefault: true, model: "claude-sonnet-4-6", provider: "Anthropic", status: "active", created: "Jan 4, 2026" },
  { id: "p-paperclip", name: "Paperclip", model: "claude-opus-4", provider: "Anthropic", status: "active", created: "Feb 18, 2026" },
  { id: "p-coder", name: "Coder", model: "claude-sonnet-4-6", provider: "Anthropic", status: "inactive", created: "Mar 2, 2026" },
];

export const MODEL_OPTIONS = [
  "claude-sonnet-4-6",
  "claude-opus-4",
  "grok-4.3",
  "grok-4.20-0309-non-reasoning",
];

export const PROVIDER_OPTIONS = ["Anthropic", "xAI"];

export const SKILL_OPTIONS = [
  "sofia-docker-setup",
  "ls-house-platform",
  "n8n-workflow-building",
  "calcom-scheduling",
  "erpnext-docker",
];

// ─── Cron ────────────────────────────────────────────────────────────────────

export type RunStatus = "success" | "failed" | "running";

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  lastRun: string;
  nextRun: string;
  enabled: boolean;
  lastStatus: RunStatus;
  description: string;
}

export const CRON_JOBS: CronJob[] = [
  { id: "c-morning", name: "Morning Brief", schedule: "6:45 AM daily", lastRun: "Today 6:45 AM", nextRun: "Tomorrow 6:45 AM", enabled: true, lastStatus: "success", description: "Assembles overnight activity into C's morning brief." },
  { id: "c-sofia", name: "Sofia Briefing", schedule: "12:00 PM weekdays", lastRun: "Today 12:00 PM", nextRun: "Tomorrow 12:00 PM", enabled: true, lastStatus: "success", description: "Midday client-pipeline summary for Sofia." },
  { id: "c-overdue", name: "Overdue Orders Alert", schedule: "Every 2 hours", lastRun: "30 min ago", nextRun: "In 90 min", enabled: true, lastStatus: "running", description: "Flags orders past their promised date." },
  { id: "c-weekly", name: "Weekly Review", schedule: "Monday 8 AM", lastRun: "Last Monday", nextRun: "Next Monday", enabled: true, lastStatus: "success", description: "Revenue, capacity, and client trends for the week." },
  { id: "c-square", name: "Square Sync", schedule: "6:15 AM daily", lastRun: "Today 6:15 AM", nextRun: "Tomorrow 6:15 AM", enabled: true, lastStatus: "success", description: "Pulls payments from Square into the ERP." },
];

// ─── Memory ──────────────────────────────────────────────────────────────────

export const USER_PROFILE: string[] = [
  "C communicates via iMessage (BlueBubbles)",
  "Short, direct — lead with action",
  "Thinks in end-to-end pipelines",
  "Delegates long builds to Claude Code",
  "Sicily trip July 2026",
];

export const MEMORY_NOTES: string[] = [
  "Supabase project: eusjiygcqzsmqonhuxlq",
  "ERP at erp.lstailors.com — ERPNext 16",
  "Sofia Docker: sophia-agent, ports 8000+8501",
  "Cal.com schedule ID 1415186",
  "Twilio: +12123084431 Sofia, MG9221599972ec",
];

export interface HouseSkill {
  name: string;
  category: string;
  version: string;
  lastUsed: string;
  description: string;
}

export const SKILLS: HouseSkill[] = [
  { name: "sofia-docker-setup", category: "Infrastructure", version: "v2.1", lastUsed: "2 days ago", description: "Provisions and maintains Sofia's Docker stack — the sophia-agent container, ports 8000 and 8501, environment, and Twilio wiring. Used by Marco for restarts and recovery." },
  { name: "ls-house-platform", category: "Platform", version: "v4.0", lastUsed: "just now", description: "Core knowledge of the L&S House operating platform — agents, approvals, memory, and how Mission Control fits together. The shared base skill every agent loads." },
  { name: "n8n-workflow-building", category: "Automation", version: "v1.6", lastUsed: "1 hour ago", description: "Builds and edits n8n workflows — triggers, webhooks, and integrations across Square, Twilio, and the ERP. Used for scheduled jobs and event automation." },
  { name: "erpnext-docker", category: "Infrastructure", version: "v3.2", lastUsed: "this morning", description: "Operates the ERPNext 16 instance at erp.lstailors.com — backups, migrations, and the doctype model that holds orders, clients, and revenue." },
  { name: "calcom-scheduling", category: "Scheduling", version: "v2.4", lastUsed: "18 min ago", description: "Reads and writes the Cal.com calendar (schedule 1415186) — booking, rescheduling, room balancing, and ERP appointment sync. Owned by Mia and Sofia." },
  { name: "hermes-agent", category: "Core", version: "v5.1", lastUsed: "just now", description: "The Hermes agent runtime itself — profiles, model routing, memory, and skill loading. The engine each profile runs on." },
];

// ─── Live Activity ───────────────────────────────────────────────────────────

export interface ActivityLogEntry {
  time: string;
  agent: string;
  text: string;
}

export const ACTIVITY_LOG: ActivityLogEntry[] = [
  { time: "14:02", agent: "Sofia", text: "Replied to client +1631 re: appointment" },
  { time: "13:45", agent: "Maestro", text: "Morning brief delivered to C" },
  { time: "13:30", agent: "Marco", text: "Square sync completed — 3 new payments" },
  { time: "12:00", agent: "Maestro", text: "Overdue orders alert sent — 14 orders flagged" },
  { time: "11:20", agent: "Mia", text: "Rebalanced 3 fittings across Madison Ave rooms" },
  { time: "10:48", agent: "Sofia", text: "Booked appointment — Tue 2:00 PM" },
  { time: "09:15", agent: "Simone", text: "Triaged 12 emails — 2 flagged urgent" },
  { time: "08:30", agent: "Paperclip", text: "Drafted Q3 capacity plan" },
  { time: "07:10", agent: "La Penna", text: "Polished spring campaign copy" },
  { time: "06:45", agent: "Maestro", text: "Morning brief assembled from overnight activity" },
];
