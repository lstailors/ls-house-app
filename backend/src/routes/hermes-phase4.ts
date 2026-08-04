// SPEC 072 Phase 4 — session search, profiles, learning graph, cron mutations
// Mounted from mission-control.ts

import type { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  hermesCredsConfigured,
  hermesDeepLinks,
  hermesFetch,
} from "../lib/hermes-dashboard";

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

async function requireMc(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { error: c.json({ error: { message: "Unauthorized" } }, 401) as any };
  if (!isMissionControl(user.role)) {
    return { error: c.json({ error: { message: "Forbidden" } }, 403) as any };
  }
  return { user };
}

function requireSuper(user: { role: string }, c: any) {
  if (user.role !== "super_admin") {
    return c.json(
      { error: { message: "Forbidden: super_admin required for Hermes cron mutations" } },
      403,
    );
  }
  return null;
}

function hermesErr(
  r: { error?: string; status: number; json: any },
  empty: Record<string, unknown> = {},
) {
  return {
    data: {
      ...empty,
      auth_configured: hermesCredsConfigured(),
      error: r.error || r.json?.detail || r.json?.error || `status ${r.status}`,
      links: hermesDeepLinks(),
    },
  };
}

export function mountHermesPhase4(router: Hono) {
  router.get("/hermes/sessions/search", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const q = c.req.query("q") || "";
    const limit = c.req.query("limit") || "20";
    const profile = c.req.query("profile");
    const qs = new URLSearchParams({ q, limit });
    if (profile) qs.set("profile", profile);
    const r = await hermesFetch(`/api/sessions/search?${qs}`, {}, { auth: true });
    if (r.error || r.status >= 400) return c.json(hermesErr(r, { results: [] }));
    const results = Array.isArray(r.json) ? r.json : r.json?.results ?? [];
    return c.json({ data: { results, q, auth_configured: true, links: hermesDeepLinks() } });
  });

  router.get("/hermes/profiles", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const r = await hermesFetch("/api/profiles", {}, { auth: true });
    if (r.error || r.status >= 400) return c.json(hermesErr(r, { profiles: [] }));
    const profiles = Array.isArray(r.json) ? r.json : r.json?.profiles ?? r.json?.data ?? [];
    return c.json({ data: { profiles, auth_configured: true, links: hermesDeepLinks() } });
  });

  router.get("/hermes/profiles/sessions", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const profile = c.req.query("profile");
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const r = await hermesFetch(`/api/profiles/sessions${qs}`, {}, { auth: true });
    if (r.error || r.status >= 400) {
      return c.json(hermesErr(r, { sessions: [], profile_totals: {} }));
    }
    return c.json({
      data: {
        ...(typeof r.json === "object" && r.json ? r.json : { sessions: r.json }),
        auth_configured: true,
        links: hermesDeepLinks(),
      },
    });
  });

  router.get("/hermes/learning/graph", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const profile = c.req.query("profile");
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const r = await hermesFetch(`/api/learning/graph${qs}`, {}, { auth: true });
    if (r.error || r.status >= 400) {
      return c.json(hermesErr(r, { nodes: [], edges: [], clusters: [], stats: null }));
    }
    return c.json({
      data: {
        ...(r.json || {}),
        auth_configured: true,
        links: hermesDeepLinks(),
      },
    });
  });

  router.get("/hermes/cron/delivery-targets", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const r = await hermesFetch("/api/cron/delivery-targets", {}, { auth: true });
    if (r.error || r.status >= 400) return c.json(hermesErr(r, { targets: [] }));
    const targets = Array.isArray(r.json) ? r.json : r.json?.targets ?? [];
    return c.json({ data: { targets, auth_configured: true } });
  });

  router.get("/hermes/cron/jobs/:id", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const id = encodeURIComponent(c.req.param("id"));
    const profile = c.req.query("profile");
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const r = await hermesFetch(`/api/cron/jobs/${id}${qs}`, {}, { auth: true });
    if (r.error || r.status >= 400) {
      return c.json(hermesErr(r, { job: null }), r.status === 404 ? 404 : 200);
    }
    return c.json({ data: { job: r.json, auth_configured: true } });
  });

  router.get("/hermes/cron/jobs/:id/runs", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const id = encodeURIComponent(c.req.param("id"));
    const profile = c.req.query("profile");
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const r = await hermesFetch(`/api/cron/jobs/${id}/runs${qs}`, {}, { auth: true });
    if (r.error || r.status >= 400) return c.json(hermesErr(r, { runs: [] }));
    const runs = Array.isArray(r.json) ? r.json : r.json?.runs ?? [];
    return c.json({ data: { runs, auth_configured: true } });
  });

  router.post("/hermes/cron/jobs", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const denied = requireSuper(gate.user!, c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({} as any));
    const profile = typeof body.profile === "string" ? body.profile : "default";
    const qs = `?profile=${encodeURIComponent(profile)}`;
    const payload = {
      prompt: body.prompt ?? "",
      schedule: body.schedule,
      name: body.name ?? "",
      deliver: body.deliver ?? "local",
      skills: body.skills,
      model: body.model,
      provider: body.provider,
      script: body.script,
      no_agent: Boolean(body.no_agent),
      workdir: body.workdir,
    };
    if (!payload.schedule || typeof payload.schedule !== "string") {
      return c.json({ error: { message: "schedule is required" } }, 400);
    }
    const r = await hermesFetch(
      `/api/cron/jobs${qs}`,
      { method: "POST", body: JSON.stringify(payload) },
      { auth: true },
    );
    if (r.error || r.status >= 400) {
      const code = r.status >= 400 && r.status < 600 ? r.status : 502;
      return c.json(
        {
          error: {
            message: String(r.error || r.json?.detail || r.json?.error || `status ${r.status}`),
          },
          data: r.json,
        },
        code as any,
      );
    }
    return c.json({ data: { job: r.json, ok: true } }, 201);
  });

  router.put("/hermes/cron/jobs/:id", async (c) => {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const denied = requireSuper(gate.user!, c);
    if (denied) return denied;
    const id = encodeURIComponent(c.req.param("id"));
    const body = await c.req.json().catch(() => ({} as any));
    const profile = typeof body.profile === "string" ? body.profile : undefined;
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const updates =
      body.updates && typeof body.updates === "object" ? { ...body.updates } : { ...body };
    delete (updates as any).profile;
    delete (updates as any).updates;
    const r = await hermesFetch(
      `/api/cron/jobs/${id}${qs}`,
      { method: "PUT", body: JSON.stringify({ updates }) },
      { auth: true },
    );
    if (r.error || r.status >= 400) {
      const code = r.status >= 400 && r.status < 600 ? r.status : 502;
      return c.json(
        {
          error: {
            message: String(r.error || r.json?.detail || r.json?.error || `status ${r.status}`),
          },
        },
        code as any,
      );
    }
    return c.json({ data: { job: r.json, ok: true } });
  });

  async function cronAction(c: any, action: "pause" | "resume" | "trigger") {
    const gate = await requireMc(c);
    if (gate.error) return gate.error;
    const denied = requireSuper(gate.user!, c);
    if (denied) return denied;
    const id = encodeURIComponent(c.req.param("id"));
    const profile = c.req.query("profile");
    const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    const r = await hermesFetch(
      `/api/cron/jobs/${id}/${action}${qs}`,
      { method: "POST", body: "{}" },
      { auth: true },
    );
    if (r.error || r.status >= 400) {
      const code = r.status >= 400 && r.status < 600 ? r.status : 502;
      return c.json(
        {
          error: {
            message: String(r.error || r.json?.detail || r.json?.error || `status ${r.status}`),
          },
        },
        code as any,
      );
    }
    return c.json({ data: { job: r.json, ok: true, action } });
  }

  router.post("/hermes/cron/jobs/:id/pause", (c) => cronAction(c, "pause"));
  router.post("/hermes/cron/jobs/:id/resume", (c) => cronAction(c, "resume"));
  router.post("/hermes/cron/jobs/:id/trigger", (c) => cronAction(c, "trigger"));
}
