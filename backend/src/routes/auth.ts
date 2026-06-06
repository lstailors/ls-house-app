import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { signToken } from "../lib/jwt";

export const authRouter = new Hono();

const ERP_BASE = () => process.env.ERPNEXT_BASE_URL ?? "";

authRouter.post(
  "/login",
  zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const base = ERP_BASE();
    if (!base) return c.json({ error: { message: "Auth service unavailable" } }, 503);

    // Validate credentials against ERPNext
    const loginRes = await fetch(`${base}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ usr: email, pwd: password }),
    }).catch(() => null);

    if (!loginRes || !loginRes.ok) {
      return c.json({ error: { message: "Invalid email or password" } }, 401);
    }

    const loginJson = await loginRes.json().catch(() => ({})) as any;
    // ERPNext returns { message: "Logged In" } on success
    if (loginJson?.message !== "Logged In") {
      return c.json({ error: { message: "Invalid email or password" } }, 401);
    }

    // Fetch full name from ERPNext User record (using admin API key)
    const key = process.env.ERPNEXT_API_KEY ?? "";
    const secret = process.env.ERPNEXT_API_SECRET ?? "";
    let fullName = email;
    if (key && secret) {
      const userRes = await fetch(
        `${base}/api/resource/User/${encodeURIComponent(email)}?fields=["full_name"]`,
        { headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" } },
      ).catch(() => null);
      if (userRes?.ok) {
        const userJson = await userRes.json().catch(() => ({})) as any;
        fullName = userJson?.data?.full_name ?? email;
      }
    }

    const token = await signToken({ sub: email, name: fullName });
    return c.json({ data: { token, user: { email, name: fullName } } });
  },
);

authRouter.post("/logout", (c) => {
  // Stateless JWT — client drops the token. Nothing to do server-side.
  return c.json({ data: { ok: true } });
});
