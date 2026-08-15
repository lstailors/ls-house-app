import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { api } from "@ls/api-client";
import { getStoredToken } from "@ls/auth/authClient";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import MtmStatusRail from "@alts/components/MtmStatusRail";
import { clientInitials } from "@alts/lib/ticketDisplay";
import "@alts/styles/alts-pos.css";

type QcCheck = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  pass: boolean | null;
};

type Photo = { id: string; name?: string; url: string; createdAt?: string };

type Inspection = {
  id: string | null;
  name?: string | null;
  salesOrder?: string | null;
  customOrder?: string | null;
  mtmproOrder?: string | null;
  orderName?: string | null;
  customer?: string | null;
  customerName?: string | null;
  inspector?: string | null;
  result?: string;
  notes?: string;
  failReason?: string;
  nextStatus?: string | null;
  checks?: QcCheck[];
  summary?: { total: number; passed: number; failed: number; open: number };
  signedAt?: string | null;
  signatureUrl?: string | null;
  docusealEmbedSrc?: string | null;
  scanUrl?: string;
  photos?: Photo[];
  docuseal?: boolean;
  orderStatus?: string | null;
  orderType?: string | null;
  factory?: string | null;
  needBy?: string | null;
  garmentSummary?: string | null;
  links?: { customer?: string | null; salesOrder?: string | null; mtmproOrder?: string | null };
};

const API = import.meta.env.VITE_BACKEND_URL || "";
const QR_API = `${API || ""}/api/qr`;

function groupChecks(checks: QcCheck[]) {
  const map = new Map<string, QcCheck[]>();
  for (const c of checks) {
    const list = map.get(c.group) || [];
    list.push(c);
    map.set(c.group, list);
  }
  return [...map.entries()];
}

export default function QcInspection() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<SignatureCanvas>(null);
  const [notes, setNotes] = useState("");
  const [failReason, setFailReason] = useState("");
  const [checks, setChecks] = useState<QcCheck[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [decide, setDecide] = useState<"pass" | "fail" | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["alts-qc-detail", id],
    enabled: !!id,
    queryFn: () => api.get<Inspection>(`/api/qc/${encodeURIComponent(id)}`),
  });

  const data = detail.data;
  const inspectionId = data?.id || data?.name || null;
  const orderName =
    data?.orderName || data?.mtmproOrder || data?.customOrder || data?.links?.mtmproOrder || null;

  const setOrderStatus = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/api/qc/orders/${encodeURIComponent(orderName!)}/status`, { status }),
    onMutate: (status) => setPendingStatus(status),
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["alts-qc"] });
      void qc.invalidateQueries({ queryKey: ["alts-qc-detail", id] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update status"),
    onSettled: () => setPendingStatus(null),
  });

  const skipCheckSave = useRef(true);

  useEffect(() => {
    const row = detail.data;
    if (!row) return;
    skipCheckSave.current = true;
    setNotes(row.notes || "");
    setFailReason(row.failReason || "");
    setChecks(row.checks || []);
    setEmbedSrc(row.docusealEmbedSrc || null);
  }, [inspectionId]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const start = useMutation({
    mutationFn: () =>
      api.post<{ id: string; name?: string }>("/api/qc", {
        customOrder: data?.mtmproOrder || (data as Inspection & { customOrder?: string })?.customOrder,
        salesOrder: data?.salesOrder || undefined,
      }),
    onSuccess: (created) => {
      const next = created.id || created.name;
      if (!next) return toast.error("Could not open QC in ERPNext");
      toast.success("QC opened");
      nav(`/qc/${encodeURIComponent(next)}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "Could not start QC"),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<Inspection>(`/api/qc/${encodeURIComponent(inspectionId!)}`, body),
    onSuccess: (saved) => {
      qc.setQueryData(["alts-qc-detail", id], (prev: Inspection | undefined) => ({
        ...(prev || saved),
        ...saved,
        checks: prev?.checks ?? saved.checks,
      }));
      qc.invalidateQueries({ queryKey: ["alts-qc"] });
      qc.invalidateQueries({ queryKey: ["alts-qc-count"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const token = getStoredToken();
      const res = await fetch(`${API}/api/qc/${encodeURIComponent(inspectionId!)}/photos`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Upload failed");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Photo saved");
      qc.invalidateQueries({ queryKey: ["alts-qc-detail", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signPad = useMutation({
    mutationFn: async () => {
      const pad = sigRef.current;
      if (!pad || pad.isEmpty()) throw new Error("Sign the pad first");
      const signatureDataUrl = pad.getCanvas().toDataURL("image/png");
      return api.post(`/api/qc/${encodeURIComponent(inspectionId!)}/sign`, { signatureDataUrl });
    },
    onSuccess: () => {
      toast.success("Signed");
      qc.invalidateQueries({ queryKey: ["alts-qc-detail", id] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save signature"),
  });

  const startDocuseal = useMutation({
    mutationFn: () => api.post<{ embedSrc?: string | null }>(`/api/qc/${encodeURIComponent(inspectionId!)}/sign`, {}),
    onSuccess: (res) => {
      if (res.embedSrc) setEmbedSrc(res.embedSrc);
      else toast.error("DocuSeal did not return a signing page");
    },
    onError: (e: Error) => toast.error(e.message || "Could not start DocuSeal"),
  });

  const loadPdf = async () => {
    const target = inspectionId || id;
    const token = getStoredToken();
    const res = await fetch(`${API}/api/qc/${encodeURIComponent(target)}/pdf`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      toast.error("No order PDF on this make");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setShowPdf(true);
  };

  const setCheck = (checkId: string, pass: boolean | null) => {
    setChecks((prev) => prev.map((c) => (c.id === checkId ? { ...c, pass } : c)));
  };

  const markGroup = (group: string, pass: boolean) => {
    setChecks((prev) => prev.map((c) => (c.group === group ? { ...c, pass } : c)));
  };

  const persistChecks = () => {
    if (!inspectionId) return;
    save.mutate({ checks, notes, failReason });
  };

  const summary = useMemo(() => {
    const total = checks.length;
    const passed = checks.filter((c) => c.pass === true).length;
    const failed = checks.filter((c) => c.pass === false).length;
    return { total, passed, failed, open: total - passed - failed };
  }, [checks]);

  const finish = (result: "Pass" | "Fail") => {
    if (!inspectionId) return;
    if (result === "Fail" && !String(notes || failReason).trim()) {
      toast.error("Notes are required to fail");
      return;
    }
    save.mutate(
      {
        checks,
        notes: notes || failReason,
        qc_result: result,
      },
      {
        onSuccess: () => {
          toast.success(result === "Pass" ? "Passed" : "Failed");
          setDecide(null);
          qc.invalidateQueries({ queryKey: ["alts-qc-detail", id] });
        },
      },
    );
  };

  const scanUrl =
    data?.scanUrl ||
    `https://alts.lstailors.com/qc/${encodeURIComponent(inspectionId || id)}`;
  const qrSrc = `${QR_API}?data=${encodeURIComponent(scanUrl)}&size=280`;
  const locked = /^(pass|fail)$/i.test(String((data as Inspection & { qcResult?: string })?.qcResult || data?.result || ""));
  const groups = groupChecks(checks);
  const photos = data?.photos ?? [];

  useEffect(() => {
    if (!inspectionId || locked) return;
    if (!checks.length) return;
    if (skipCheckSave.current) {
      skipCheckSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      save.mutate({ checks, notes, failReason });
    }, 900);
    return () => clearTimeout(t);
  }, [checks, failReason, inspectionId, locked, notes, save]);

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <Link to="/qc" className="text-cream-dim p-2 min-h-[44px] min-w-[44px] inline-flex items-center">
          ←
        </Link>
        <span className="sf-avatar" aria-hidden>
          {clientInitials(data?.customerName || "QC")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="display text-[26px] leading-none truncate">{data?.customerName || "Quality Control"}</div>
          <div className="caps mt-1 truncate">
            {[data?.mtmproOrder || id, data?.salesOrder, data?.orderStatus || data?.result]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowQr(true)}
          className="h-11 px-3 rounded-full border border-brass/30 text-[11px] font-bold uppercase tracking-widest"
        >
          Scan code
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 pb-[max(7rem,calc(env(safe-area-inset-bottom)+6rem))]">
        {detail.isError && (
          <QueryErrorPanel
            title="Could not load this QC"
            message={detail.error instanceof Error ? detail.error.message : "Retry."}
            onRetry={() => detail.refetch()}
          />
        )}

        {data && !inspectionId && (
          <div className="card-glass px-4 py-5">
            <div className="display text-2xl">Not opened yet</div>
            <p className="text-sm text-cream-dim mt-2">
              This is an MTM order. Open a store QC on it — photos, checks, the order PDF, and a signature.
            </p>
            <button
              type="button"
              disabled={start.isPending}
              onClick={() => start.mutate()}
              className="btn-brass h-12 w-full mt-4 text-xs"
            >
              {start.isPending ? "Opening…" : "Start QC"}
            </button>
          </div>
        )}

        <div className="card-glass px-4 py-4">
          <div className="caps text-brass-light">Order</div>
          <div className="display text-[28px] leading-none mt-1">{data?.customerName || "Client"}</div>
          <p className="text-sm text-cream-dim mt-2">
            {[data?.garmentSummary, data?.orderType, data?.factory, data?.needBy]
              .filter(Boolean)
              .join(" · ") || "MTM make — not an alteration ticket"}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {data?.mtmproOrder && <span className="chip">{data.mtmproOrder}</span>}
            {data?.salesOrder && <span className="chip">{data.salesOrder}</span>}
          </div>
          <div className="mt-4">
            <div className="caps text-brass-light mb-2">Live order status</div>
            <MtmStatusRail
              current={data?.orderStatus}
              pending={pendingStatus}
              onChange={orderName ? (status) => setOrderStatus.mutate(status) : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button type="button" onClick={() => void loadPdf()} className="btn-brass h-12 text-[11px]">
              Order PDF
            </button>
            {data?.links?.customer && (
              <Link
                to={`/customers/${encodeURIComponent(data.links.customer)}`}
                className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
              >
                Client
              </Link>
            )}
          </div>
        </div>

        {inspectionId && (
          <>
            <div className="card-glass px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="caps">Checks</div>
                <div className="text-sm text-cream-dim mt-1">
                  {summary.passed} pass · {summary.failed} fail · {summary.open} open
                </div>
              </div>
              {!locked && (
                <button
                  type="button"
                  onClick={() => setChecks((prev) => prev.map((c) => ({ ...c, pass: true })))}
                  className="h-11 px-3 rounded-full border border-brass/30 text-[11px] font-bold uppercase tracking-widest"
                >
                  All pass
                </button>
              )}
            </div>

            {groups.map(([group, rows]) => (
              <section key={group} className="card-glass overflow-hidden">
                <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center gap-2">
                  <h2 className="display text-[18px] m-0 flex-1">{group}</h2>
                  {!locked && (
                    <>
                      <button
                        type="button"
                        onClick={() => markGroup(group, true)}
                        className="h-11 px-3 rounded-full border border-brass/30 text-[11px] font-bold uppercase tracking-widest"
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => markGroup(group, false)}
                        className="h-11 px-3 rounded-full border border-signal-rose/40 text-[11px] font-bold uppercase tracking-widest text-signal-rose"
                      >
                        Fail
                      </button>
                    </>
                  )}
                </div>
                {rows.map((row) => (
                  <div key={row.id} className="px-4 py-3 border-b border-brass/10 last:border-0">
                    <div className="text-[14px] font-semibold">{row.label}</div>
                    {row.hint && <div className="text-[12px] text-cream-dim mt-0.5">{row.hint}</div>}
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {(
                        [
                          [true, "Pass", "bg-signal-emerald/20 border-signal-emerald text-signal-emerald"],
                          [false, "Fail", "bg-signal-rose/15 border-signal-rose/50 text-signal-rose"],
                          [null, "Skip", "border-brass/25 text-cream-dim"],
                        ] as const
                      ).map(([val, lab, cls]) => (
                        <button
                          key={lab}
                          type="button"
                          disabled={locked}
                          onClick={() => setCheck(row.id, val)}
                          className={cn(
                            "h-11 rounded-xl border text-[11px] font-bold uppercase tracking-widest",
                            row.pass === val ? cls : "border-brass/20 text-cream-dim",
                          )}
                        >
                          {lab}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}

            <label className="block card-glass px-4 py-4">
              <span className="caps mb-1.5 block">Notes</span>
              <textarea
                value={notes}
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={persistChecks}
                rows={3}
                placeholder="Press, hang, anything the fitter should know"
                className="w-full rounded-xl bg-black/35 border border-brass/25 px-3.5 py-3 text-[14.5px] text-cream outline-none focus:border-brass"
              />
            </label>

            <section className="card-glass overflow-hidden">
              <div className="px-4 py-3 border-b border-brass/15 bg-black/20">
                <h2 className="display text-[18px] m-0">Photos</h2>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!inspectionId || upload.isPending || locked}
                    onClick={() => cameraRef.current?.click()}
                    className="btn-brass h-14 text-[11px]"
                  >
                    {upload.isPending ? "Uploading…" : "📷 Camera"}
                  </button>
                  <button
                    type="button"
                    disabled={!inspectionId || upload.isPending || locked}
                    onClick={() => libraryRef.current?.click()}
                    className="h-14 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest"
                  >
                    Library
                  </button>
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={libraryRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-brass/20">
                      <img src={p.url} alt={p.name || "QC photo"} className="w-full aspect-square object-cover bg-black/40" />
                    </a>
                  ))}
                </div>
              </div>
            </section>

            <section className="card-glass overflow-hidden">
              <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center">
                <h2 className="display text-[18px] m-0 flex-1">Sign</h2>
                {data?.signedAt && <span className="text-[11px] font-bold uppercase tracking-widest text-signal-emerald">Signed</span>}
              </div>
              <div className="p-4 space-y-3">
                {data?.signatureUrl && (
                  <img src={data.signatureUrl} alt="Signature" className="w-full max-h-36 object-contain rounded-xl bg-[#F6F1E4]" />
                )}
                {embedSrc && (
                  <iframe title="DocuSeal" src={embedSrc} className="w-full min-h-[420px] rounded-xl border border-brass/25 bg-white" />
                )}
                {!locked && data?.docuseal && !embedSrc && (
                  <button
                    type="button"
                    disabled={startDocuseal.isPending}
                    onClick={() => startDocuseal.mutate()}
                    className="btn-brass h-12 w-full text-xs"
                  >
                    {startDocuseal.isPending ? "Opening DocuSeal…" : "Sign with DocuSeal"}
                  </button>
                )}
                {!locked && (
                  <>
                    <div
                      className="h-[168px] rounded-[14px] relative overflow-hidden border border-brass/30"
                      style={{ background: "#F6F1E4" }}
                    >
                      <SignatureCanvas
                        ref={sigRef}
                        penColor="#1F3A2E"
                        canvasProps={{
                          className: "absolute inset-0 w-full h-full",
                          style: { width: "100%", height: "100%" },
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => sigRef.current?.clear()}
                        className="h-12 rounded-xl border border-brass/25 text-[11px] font-bold uppercase tracking-widest"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        disabled={signPad.isPending}
                        onClick={() => signPad.mutate()}
                        className="btn-brass h-12 text-[11px]"
                      >
                        Save signature
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>

            {!locked && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    persistChecks();
                    setDecide("fail");
                  }}
                  className="h-14 rounded-xl border border-signal-rose/45 text-[12px] font-bold uppercase tracking-widest text-signal-rose"
                >
                  Fail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    persistChecks();
                    setDecide("pass");
                  }}
                  className="btn-brass h-14 text-[12px]"
                >
                  Pass
                </button>
              </div>
            )}
            {locked && (
              <div className="card-glass px-4 py-4 text-center">
                <div className="display text-2xl">{data?.result}</div>
                <div className="text-sm text-cream-dim mt-1">{data?.nextStatus || data?.orderStatus}</div>
              </div>
            )}
          </>
        )}
      </div>

      <LuxuryLayer open={showPdf} onClose={() => setShowPdf(false)} variant="sheet" label="Order PDF" z={80}>
        <div
          className="w-full max-w-3xl mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
        >
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="display text-xl flex-1">Order PDF</div>
            <button type="button" onClick={() => setShowPdf(false)} className="h-11 px-3 rounded-full border border-brass/30 text-xs">
              Close
            </button>
          </div>
          {pdfUrl ? (
            <iframe title="Order PDF" src={pdfUrl} className="w-full h-[70vh] rounded-xl bg-white" />
          ) : (
            <div className="sf-empty">No PDF</div>
          )}
        </div>
      </LuxuryLayer>

      <LuxuryLayer open={showQr} onClose={() => setShowQr(false)} variant="sheet" label="QC scan code" z={80}>
        <div
          className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center"
          style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
        >
          <div className="caps text-brass-light">Scan on the floor</div>
          <h2 className="display text-[28px] leading-none mt-1">{data?.customerName || "QC"}</h2>
          <img src={qrSrc} alt="QC QR" className="mx-auto mt-4 w-44 h-44 rounded-xl bg-white p-2" />
          <p className="font-mono text-xs text-cream-dim mt-3 break-all">{scanUrl}</p>
          <button type="button" onClick={() => setShowQr(false)} className="btn-ghost h-12 w-full mt-4 text-xs">
            Close
          </button>
        </div>
      </LuxuryLayer>

      <LuxuryLayer open={!!decide} onClose={() => setDecide(null)} variant="sheet" label="QC result" z={80}>
        {decide === "pass" && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <h2 className="display text-[32px] leading-none">Pass</h2>
            <p className="text-sm text-cream-dim mt-2">ERPNext will move this make to Awaiting Fitting, or Awaiting Shipment if it ships direct.</p>
            {summary.open > 0 && (
              <p className="text-xs text-signal-amber mt-2">{summary.open} checks still open — they will stay as skip.</p>
            )}
            <div className="flex flex-col gap-2 mt-5">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => finish("Pass")}
                className="btn-brass h-14 text-xs"
              >
                Confirm pass
              </button>
              <button type="button" onClick={() => setDecide(null)} className="btn-ghost h-12 text-xs">
                Back
              </button>
            </div>
          </div>
        )}
        {decide === "fail" && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <h2 className="display text-[32px] leading-none">Fail</h2>
            <p className="text-sm text-cream-dim mt-2">Sends the MTM order to Alterations. It comes back through QC.</p>
            <label className="block mt-4">
              <span className="caps mb-1.5 block">What failed</span>
              <textarea
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                rows={3}
                placeholder="Hem, collar, stain, missing piece…"
                className="w-full rounded-xl bg-black/35 border border-brass/25 px-3.5 py-3 text-[14.5px] text-cream outline-none focus:border-brass"
              />
            </label>
            <div className="flex flex-col gap-2 mt-5">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => finish("Fail")}
                className="h-14 rounded-xl border border-signal-rose/50 text-[12px] font-bold uppercase tracking-widest text-signal-rose"
              >
                Send to Alterations
              </button>
              <button type="button" onClick={() => setDecide(null)} className="btn-ghost h-12 text-xs">
                Back
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>
    </div>
  );
}
