import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { ME_KEY, useMe } from "@ls/auth/session";
import { clearClientSession, signOut } from "@ls/auth/authClient";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import { clearAltsPrivateStorage } from "@alts/lib/logoutPrivacy";
import { recalledDocusealKey, rememberDocusealKey } from "@alts/lib/docusealKey";
import { getShowTestData, setShowTestData } from "@alts/lib/showTestData";
import { canSeeHouseAdmin, houseAdminIsExternal } from "@alts/lib/houseAdmin";
import { HouseAdminLink } from "@alts/components/HouseAdminLink";
import "@alts/styles/alts-pos.css";

type SettingsData = {
  url: string;
  apiKeySet: boolean;
  apiKeyMasked: string;
  webhookUrl?: string;
};

export default function AltsSettings() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "super_admin";
  const canOpenHouseAdmin = canSeeHouseAdmin(me?.role);
  const [apiKey, setApiKey] = useState("");
  const [url, setUrl] = useState("");
  const [showTest, setShowTest] = useState(getShowTestData);

  const settings = useQuery({
    queryKey: ["alts-qc-settings"],
    enabled: isAdmin,
    queryFn: () => api.get<SettingsData>("/api/qc/settings"),
  });

  useEffect(() => {
    if (settings.data?.url && !url) setUrl(settings.data.url);
  }, [settings.data, url]);

  useEffect(() => {
    if (!settings.data || settings.data.apiKeySet) return;
    const remembered = recalledDocusealKey();
    if (!remembered) return;
    api
      .patch<SettingsData>("/api/qc/settings", { apiKey: remembered })
      .then((data) => qc.setQueryData(["alts-qc-settings"], data))
      .catch(() => null);
  }, [settings.data, qc]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<SettingsData>("/api/qc/settings", {
        apiKey: apiKey.trim() || recalledDocusealKey() || undefined,
        url: url.trim() || undefined,
      }),
    onSuccess: (data) => {
      if (apiKey.trim()) rememberDocusealKey(apiKey);
      toast.success("Key saved on the server — you will not be asked again");
      setApiKey("");
      qc.setQueryData(["alts-qc-settings"], data);
      qc.invalidateQueries({ queryKey: ["alts-qc-settings"] });
      qc.invalidateQueries({ queryKey: ["alts-qc-detail"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/qc/settings/test", {}),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.message || "DocuSeal is connected");
      else toast.error(data.message || "DocuSeal did not answer");
    },
    onError: (e: Error) => toast.error(e.message || "DocuSeal did not answer"),
  });

  const logout = async () => {
    clearClientSession();
    qc.setQueryData(ME_KEY, null);
    clearAltsPrivateStorage();
    qc.clear();
    await signOut();
    nav("/login", { replace: true });
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">Settings</div>
          <div className="caps mt-1">{me?.name || "Staff"}</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        <div className="set-card card-glass px-4 py-4">
          <div className="caps text-brass-light">Account</div>
          <div className="display text-2xl mt-1">{me?.name || "Staff"}</div>
          <p className="text-sm text-cream-dim mt-1">{me?.email}</p>
        </div>

        {canOpenHouseAdmin && (
          <HouseAdminLink className="set-card card-glass px-4 py-4 block hover:border-brass/40 transition-colors">
            <div className="caps text-brass-light">House admin</div>
            <div className="display text-2xl mt-1">Open admin</div>
            <p className="text-sm text-cream-dim mt-1">
              {houseAdminIsExternal()
                ? "Opens the house desk on app.lstailors.com — users, financials, communications."
                : "Users, financials, communications, and the full house desk — same app."}
            </p>
          </HouseAdminLink>
        )}

        {isAdmin && (
          <div className="set-card card-glass px-4 py-4 space-y-3">
            <div className="caps text-brass-light">Operations</div>
            <p className="text-sm text-cream-dim">
              This server is in {me?.opsMode === "live" ? "LIVE" : "TEST"} mode.
              LIVE hides TEST-prefix orders from the floor. Turn this on only when you need to see those records.
            </p>
            <button
              type="button"
              onClick={() => {
                const next = !showTest;
                setShowTestData(next);
                setShowTest(next);
                qc.invalidateQueries();
                toast.success(next ? "Test records visible" : "Test records hidden");
              }}
              className={cn(
                "h-12 w-full rounded-xl border text-[12px] font-bold uppercase tracking-widest",
                showTest ? "border-brass bg-brass/20 text-cream" : "border-brass/35 text-cream-dim",
              )}
            >
              {showTest ? "Showing test data" : "Show test data"}
            </button>
          </div>
        )}

        {!isAdmin && (
          <div className="set-card card-glass px-4 py-4 space-y-2">
            <div className="caps text-brass-light">DocuSeal</div>
            <p className="text-sm text-cream-dim">
              An admin turns this on in Settings with the API key. You can still sign on the cream pad on the QC ticket.
            </p>
          </div>
        )}

        {isAdmin && (
          <div className="set-card card-glass px-4 py-4 space-y-3">
            <div className="caps text-brass-light">DocuSeal</div>
            <p className="text-sm text-cream-dim">
              {settings.data?.apiKeySet
                ? "The key is stored on the server. You will not be asked again. Sign with DocuSeal opens a new tab — it cannot sit inside this page."
                : "Paste the API key once. It is stored as a file on the shop server so the next screen still has it."}
            </p>
            {settings.data?.apiKeySet && (
              <p className="font-mono text-xs text-brass-light">Saved · {settings.data.apiKeyMasked}</p>
            )}
            <ol className="text-sm text-cream-dim list-decimal pl-5 space-y-1">
              <li>Paste the API key, tap Save, then Test.</li>
              <li>In DocuSeal: New Template, add a Signature box, save.</li>
              <li>In DocuSeal Webhooks, paste the URL below so signed copies file back on the ticket.</li>
            </ol>
            <p className="font-mono text-[11px] text-brass-light break-all">
              {settings.data?.webhookUrl || "https://app.lstailors.com/api/webhooks/docuseal"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="https://docuseal.lstailors.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="h-12 px-3 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
              >
                API key
              </a>
              <a
                href="https://docuseal.lstailors.com/templates"
                target="_blank"
                rel="noreferrer"
                className="h-12 px-3 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
              >
                Templates
              </a>
            </div>
            <label className="block">
              <span className="caps mb-1.5 block">Host</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={settings.data?.url || "https://docuseal.lstailors.com"}
                className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-[15px] text-cream outline-none focus:border-brass"
              />
            </label>
            <label className="block">
              <span className="caps mb-1.5 block">API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.data?.apiKeySet ? "••••••••" : "Paste key"}
                className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-[15px] text-cream outline-none focus:border-brass"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={save.isPending || (!apiKey.trim() && !url.trim())}
                onClick={() => save.mutate()}
                className="btn-brass h-12 w-full text-xs disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save DocuSeal"}
              </button>
              <button
                type="button"
                disabled={test.isPending || (!settings.data?.apiKeySet && !apiKey.trim())}
                onClick={() => test.mutate()}
                className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest disabled:opacity-50"
              >
                {test.isPending ? "Testing…" : "Test key"}
              </button>
            </div>
          </div>
        )}

        <button type="button" onClick={() => void logout()} className={cn("h-14 w-full rounded-xl border border-brass/35 text-[12px] font-bold uppercase tracking-widest")}>
          Sign out
        </button>
      </div>
    </div>
  );
}
