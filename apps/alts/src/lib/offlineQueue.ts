/**
 * Offline mutation queue for alts intake ticket creates.
 * Drafts already survive wifi drops; this queues the POST when Finish is
 * tapped offline and flushes when the tablet is back online.
 */
import { api } from "@ls/api-client";

export const ALTS_OFFLINE_QUEUE_KEY = "alts.offlineQueue.v1";
export const ALTS_OFFLINE_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineTicketJob = {
  id: string;
  kind: "intake_ticket";
  createdAt: number;
  /** POST /api/intake-alterations/tickets body */
  body: Record<string, unknown>;
  clientLabel?: string;
  attempts: number;
  lastError?: string;
};

type QueueFile = {
  v: 1;
  jobs: OfflineTicketJob[];
};

function readFile(): QueueFile {
  try {
    const raw = localStorage.getItem(ALTS_OFFLINE_QUEUE_KEY);
    if (!raw) return { v: 1, jobs: [] };
    const parsed = JSON.parse(raw) as QueueFile;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.jobs)) return { v: 1, jobs: [] };
    const cutoff = Date.now() - ALTS_OFFLINE_QUEUE_TTL_MS;
    return { v: 1, jobs: parsed.jobs.filter((j) => j && j.createdAt >= cutoff) };
  } catch {
    return { v: 1, jobs: [] };
  }
}

function writeFile(f: QueueFile) {
  try {
    localStorage.setItem(ALTS_OFFLINE_QUEUE_KEY, JSON.stringify(f));
  } catch {
    /* quota */
  }
}

export function listOfflineJobs(): OfflineTicketJob[] {
  return readFile().jobs;
}

export function offlineQueueCount(): number {
  return readFile().jobs.length;
}

export function enqueueIntakeTicket(
  body: Record<string, unknown>,
  clientLabel?: string,
): OfflineTicketJob {
  const job: OfflineTicketJob = {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: "intake_ticket",
    createdAt: Date.now(),
    body,
    clientLabel,
    attempts: 0,
  };
  const f = readFile();
  f.jobs.push(job);
  writeFile(f);
  return job;
}

export function removeOfflineJob(id: string) {
  const f = readFile();
  f.jobs = f.jobs.filter((j) => j.id !== id);
  writeFile(f);
}

export type FlushResult = {
  ok: number;
  failed: number;
  remaining: number;
  errors: string[];
};

let flushing = false;

/** Flush queued ticket creates. Safe to call repeatedly. */
export async function flushOfflineQueue(): Promise<FlushResult> {
  if (flushing) return { ok: 0, failed: 0, remaining: offlineQueueCount(), errors: [] };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: 0, failed: 0, remaining: offlineQueueCount(), errors: ["offline"] };
  }
  flushing = true;
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    const f = readFile();
    const keep: OfflineTicketJob[] = [];
    for (const job of f.jobs) {
      if (job.kind !== "intake_ticket") {
        keep.push(job);
        continue;
      }
      try {
        await api.post("/api/intake-alterations/tickets", job.body);
        ok += 1;
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${job.clientLabel || job.id}: ${msg}`);
        keep.push({
          ...job,
          attempts: (job.attempts || 0) + 1,
          lastError: msg.slice(0, 200),
        });
      }
    }
    writeFile({ v: 1, jobs: keep });
    return { ok, failed, remaining: keep.length, errors };
  } finally {
    flushing = false;
  }
}

/** Wire once at app root — flushes on online + periodic tick. */
export function startOfflineQueueWatcher(
  onResult?: (r: FlushResult) => void,
): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    const before = offlineQueueCount();
    if (before === 0) return;
    const r = await flushOfflineQueue();
    if (r.ok > 0 || r.failed > 0) onResult?.(r);
  };
  const onOnline = () => {
    void run();
  };
  window.addEventListener("online", onOnline);
  const t = window.setInterval(() => {
    if (navigator.onLine) void run();
  }, 30_000);
  // immediate attempt
  if (navigator.onLine) void run();
  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    window.clearInterval(t);
  };
}
