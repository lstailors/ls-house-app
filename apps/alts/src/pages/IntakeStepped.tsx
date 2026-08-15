import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { useMe } from "@ls/auth/session";
import { cn } from "@ls/design/utils";
import ParkDrawer from "@alts/components/ParkDrawer";
import CustomerEditSheet, { SelectedCustomerCard } from "@alts/components/CustomerEditSheet";
import { clearSoCart, readSoCart, soCartToGarments } from "@alts/lib/soCart";
import {
  clearIntakeDraft,
  intakeDraftHasWork,
  readIntakeDraft,
  writeIntakeDraft,
} from "@alts/lib/intakeDraft";
import { REDO_DISPLAY } from "@alts/lib/billingLabels";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import GarmentCatalog, { type GarmentFilterId } from "@alts/components/intake/GarmentCatalog";
import TicketCartRail from "@alts/components/intake/TicketCartRail";
import TicketCartDock from "@alts/components/intake/TicketCartDock";
import TicketCartSheet from "@alts/components/intake/TicketCartSheet";
import GarmentOptionsDrawer from "@alts/components/intake/GarmentOptionsDrawer";
import SellItemCatalog, {
  type SellFilterId,
  type SellableItem,
} from "@alts/components/intake/SellItemCatalog";
import SellItemDrawer from "@alts/components/intake/SellItemDrawer";
import PromiseSchedule, { type DayLoad } from "@alts/components/intake/PromiseSchedule";
import DeliveryBlock, {
  emptyDelivery,
  type DeliverySelection,
} from "@alts/components/intake/DeliveryBlock";
import IntakeConfirm, {
  type IntakeConfirmResult,
} from "@alts/components/intake/IntakeConfirm";
import { enqueueIntakeTicket } from "@alts/lib/offlineQueue";

const GARMENT_TYPES = [
  "Jacket",
  "Trouser",
  "Shirt",
  "Dress",
  "Coat",
  "Vest",
  "Suit (2pc)",
  "Suit (3pc)",
  "Skirt",
  "Other",
] as const;

type Line = {
  id: string;
  description: string;
  price: number;
  estMinutes?: number | null;
  presetId?: string;
  /** per-line note → ERP line_notes */
  notes?: string;
  /** local preview URLs until ticket exists; then uploaded */
  photoFiles?: File[];
  photoPreviewUrls?: string[];
};
type Garment = {
  ref: string;
  garmentType: string;
  color: string;
  notes: string;
  lines: Line[];
  soItemKey?: string;
  soItemName?: string;
  /** intake condition photos (Lucia 023) — upload after ticket create */
  photoFiles?: File[];
  photoPreviewUrls?: string[];
};
type CustomerHit = {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  addressLine?: string;
};


type SellItem = {
  ref: string;
  item_code: string;
  item_name: string;
  color: string;
  size: string;
  qty: number;
  rate: number;
  availability: "in" | "order" | "out";
  eta?: string;
  source?: "erp" | "seed";
  /** attribute options from catalog at add-time */
  sizeOptions?: string[];
  colorOptions?: string[];
};

type Preset = {
  id: string;
  preset_name: string;
  display_name?: string;
  garment_type?: string;
  garment_types?: string[];
  price: number;
  est_minutes?: number | null;
  is_group?: number | boolean;
  parent_preset?: string | null;
  item_code?: string | null;
  quick_pick?: number | boolean;
  sort_order?: number;
};

type Remind = "eod" | "3d" | "2w" | "never";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function remindAtIso(remind: Remind): string | null {
  if (remind === "never") return null;
  const d = new Date();
  if (remind === "eod") {
    d.setHours(20, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (remind === "3d") {
    d.setDate(d.getDate() + 3);
    return d.toISOString();
  }
  d.setDate(d.getDate() + 14);
  return d.toISOString();
}

/** Compact take-photo / library strip for one garment (Lucia 023). */
function GarmentPhotoStrip({
  garment,
  onAdd,
  onRemove,
  large = false,
}: {
  garment: Garment;
  onAdd: (file: File) => void;
  onRemove: (idx: number) => void;
  large?: boolean;
}) {
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    Array.from(list).forEach((f) => {
      if (f.type.startsWith("image/") || !f.type) onAdd(f);
    });
  };
  const thumb = large ? "w-[4.5rem] h-[4.5rem]" : "w-12 h-12";
  const btn = large ? "h-[4.5rem] min-w-[8.5rem] px-4 text-xs" : "h-12 px-3 text-xs";
  return (
    <div className={cn("rounded-2xl border border-brass/25 bg-black/25", large ? "p-3.5" : "p-2.5")}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="caps text-brass-light">Garment photos</span>
        <span className="text-xs text-cream-dim">
          {(garment.photoPreviewUrls || []).length} attached · camera or library
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {(garment.photoPreviewUrls || []).map((src, i) => (
          <div key={i} className={cn("relative rounded-xl overflow-hidden border border-brass/30", thumb)}>
            <img src={src} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-0 right-0 w-5 h-5 rounded-bl-lg bg-black/75 text-xs text-cream grid place-items-center"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ))}
        <label
          className={cn(
            "rounded-xl border border-brass/45 bg-brass/20 text-brass-light font-bold tracking-wider uppercase grid place-items-center text-center cursor-pointer hover:bg-brass/30 active:scale-[0.98]",
            btn,
          )}
        >
          📷 Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label
          className={cn(
            "rounded-xl border border-dashed border-brass/40 text-cream-muted font-bold tracking-wider uppercase grid place-items-center text-center cursor-pointer hover:border-brass/60 hover:text-brass-light active:scale-[0.98]",
            btn,
          )}
        >
          Upload
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function garmentIcon(type: string) {
  // Simple line icons — same family as Lucia mock, no emoji
  return (
    <svg width="48" height="56" viewBox="0 0 44 52" fill="none" stroke="currentColor" strokeWidth="1.35" className="text-brass-light opacity-90">
      {type.includes("Trouser") || type === "Skirt" ? (
        <>
          <path d="M11 5h22l2 42h-9l-4-24-4 24h-9z" />
          <path d="M11 12h22" opacity=".6" />
        </>
      ) : type.includes("Shirt") ? (
        <>
          <path d="M15 5l7 5 7-5 9 5c2 1 3 3 3 5v30c0 2-1 3-3 3H8c-2 0-3-1-3-3V20c0-2 1-4 3-5z" />
          <path d="M22 10v37M15 5l7 8M29 5l-7 8" />
        </>
      ) : (
        <>
          <path d="M14 8l8-3 8 3 6 4v6l-6-2v29H14V16l-6 2v-6z" />
          <path d="M14 16h16" opacity=".5" />
        </>
      )}
    </svg>
  );
}

export default function IntakeStepped() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const resumeId = params.get("parked");
  const kindParam = params.get("kind"); // walk_in | on_order | redo
  const soParam = params.get("so");
  const customerParam = params.get("customer");
  const customerNameParam = params.get("customerName");

  const initialBilling =
    kindParam === "on_order" || kindParam === "custom"
      ? "on_order"
      : kindParam === "redo" || kindParam === "warranty"
        ? "redo"
        : "billable";

  const [step, setStep] = useState(0);
  const { data: me } = useMe();
  /** Alts FOH is NYC-only — ignore HOU location claims from /me. */
  const origin = "NYC" as const;
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // new customer fields
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newLine1, setNewLine1] = useState("");
  const [newLine2, setNewLine2] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newZip, setNewZip] = useState("");

  const [garments, setGarments] = useState<Garment[]>([]);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [notifyReady, setNotifyReady] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState<GarmentFilterId>("All");
  /** SPEC 057 — Walk-in only Alter | Sell */
  const [catalogMode, setCatalogMode] = useState<"alter" | "sell">("alter");
  const [sellItems, setSellItems] = useState<SellItem[]>([]);
  const [sellFilter, setSellFilter] = useState<SellFilterId>("all");
  const [sellQuery, setSellQuery] = useState("");
  const [sellDrawerOpen, setSellDrawerOpen] = useState(false);
  const [activeSellRef, setActiveSellRef] = useState<string | null>(null);
  /** Last step — promised due date/time */
  const [promiseDate, setPromiseDate] = useState<string | null>(null);
  const [promiseTime, setPromiseTime] = useState<string | null>("18:00");
  const [isRush, setIsRush] = useState(false);
  const [delivery, setDelivery] = useState<DeliverySelection>(() => emptyDelivery());
  const [billing, setBilling] = useState<"billable" | "on_order" | "redo">(initialBilling);
  const [linkedSo, setLinkedSo] = useState<string | null>(soParam);
  const [linkedSoLabel, setLinkedSoLabel] = useState<string | null>(null);

  // park drawer
  const [parkOpen, setParkOpen] = useState(false);
  const [parkLabel, setParkLabel] = useState("");
  const [parkNote, setParkNote] = useState("");
  const [expectedGarments, setExpectedGarments] = useState(0);
  const [remind, setRemind] = useState<Remind>("3d");
  const [parkedCartId, setParkedCartId] = useState<string | null>(resumeId);

  // 030 — work step: custom line + notes
  const [customDesc, setCustomDesc] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);
  const [ticketNote, setTicketNote] = useState("");
  const [ticketNoteKind, setTicketNoteKind] = useState<"internal" | "customer">("internal");
  /** gates draft writes until hydrate + SO seed settle */
  const [draftReady, setDraftReady] = useState(false);
  /** Real submit idempotency key — survives double-click / flaky wifi retry. Rotated only on success. */
  const submitIdempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  /** Post-submit confirmation (comms / print / checkout) — not a draft step. */
  const [confirmResult, setConfirmResult] = useState<IntakeConfirmResult | null>(null);

  const search = useQuery({
    queryKey: ["cust-search", q],
    enabled: q.trim().length >= 2 && !customer,
    queryFn: async () => {
      const rows = await api.get<any[]>(
        `/api/intake-alterations/customers/search?q=${encodeURIComponent(q.trim())}`,
      );
      return (rows ?? []).map((r: any) => {
        const addr = [r.address, r.city, r.state].filter(Boolean).join(", ");
        return {
          id: r.name ?? r.id,
          name: r.customer_name ?? r.name,
          phone: r.mobile_no ?? r.phone ?? "",
          email: r.email_id ?? r.email ?? "",
          addressLine: addr || r.address_line || "",
        } as CustomerHit;
      });
    },
  });

  const presets = useQuery({
    queryKey: ["presets", origin],
    queryFn: () => api.get<Preset[]>(`/api/intake-alterations/presets?origin=${origin}`),
  });

  const sellable = useQuery({
    queryKey: ["sellable-items", origin, sellFilter, sellQuery],
    enabled: billing === "billable" && catalogMode === "sell" && kindParam !== "on_order" && kindParam !== "redo" && kindParam !== "warranty" && kindParam !== "custom",
    queryFn: async () => {
      const qs = new URLSearchParams({
        origin,
        filter: sellFilter,
        limit: "60",
      });
      if (sellQuery.trim()) qs.set("q", sellQuery.trim());
      const res = await api.raw(`/api/alts/sellable-items?${qs.toString()}`);
      if (!res.ok) throw new Error(`sellable-items ${res.status}`);
      const json = (await res.json()) as { data?: SellableItem[]; meta?: { seeded?: boolean } };
      return { items: json.data ?? [], seeded: !!json.meta?.seeded };
    },
  });

  const scheduleLoad = useQuery({
    queryKey: ["schedule-load", origin],
    enabled: step === 3,
    queryFn: async () => {
      const from = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const res = await api.raw(`/api/alts/schedule-load?origin=${origin}&from=${from}&days=14`);
      if (!res.ok) throw new Error(`schedule-load ${res.status}`);
      const json = (await res.json()) as {
        data?: { days?: DayLoad[]; origin?: string } | DayLoad[];
      };
      const d = json.data;
      if (Array.isArray(d)) return { days: d as DayLoad[] };
      return { days: (d?.days ?? []) as DayLoad[] };
    },
  });

  // Resume parked cart
  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    (async () => {
      try {
        const cart = await api.get<any>(`/api/carts/${encodeURIComponent(resumeId)}`);
        if (cancelled || !cart) return;
        setParkedCartId(cart.id || resumeId);
        const snap = cart.customer_snapshot || {};
        const intake = cart.cart?.intake || cart.cart || {};
        setCustomer({
          id: cart.customer_ref || undefined,
          name: snap.fullName || snap.name || cart.label || "Client",
          phone: snap.phone || "",
          email: snap.email || "",
          addressLine: snap.address?.line1
            ? [snap.address.line1, snap.address.city, snap.address.state].filter(Boolean).join(", ")
            : "",
        });
        if (intake.origin === "NYC") {
          /* origin locked NYC */
        }
        if (intake.billing) setBilling(intake.billing);
        if (intake.linkedSo) setLinkedSo(intake.linkedSo);
        if (Array.isArray(intake.garments)) {
          setGarments(intake.garments);
          setActiveRef(intake.garments[0]?.ref ?? null);
        }
        if (Array.isArray(intake.sellItems)) {
          setSellItems(intake.sellItems);
          if (!intake.garments?.length && intake.sellItems[0]?.ref) {
            setActiveSellRef(intake.sellItems[0].ref);
          }
        }
        if (intake.catalogMode === "sell" || intake.catalogMode === "alter") {
          setCatalogMode(intake.catalogMode);
        }
        if (typeof intake.notifyReady === "boolean") setNotifyReady(intake.notifyReady);
        if (intake.expectedGarmentCount) setExpectedGarments(Number(intake.expectedGarmentCount) || 0);
        if (typeof intake.promiseDate === "string" && intake.promiseDate) setPromiseDate(intake.promiseDate);
        if (typeof intake.promiseTime === "string" && intake.promiseTime) setPromiseTime(intake.promiseTime);
        if (typeof intake.isRush === "boolean") setIsRush(intake.isRush);
        if (typeof intake.ticketNote === "string" && intake.ticketNote) setTicketNote(intake.ticketNote);
        if (intake.ticketNoteKind === "customer" || intake.ticketNoteKind === "internal") {
          setTicketNoteKind(intake.ticketNoteKind);
        }
        if (cart.label) setParkLabel(cart.label);
        setStep(1);
        toast.message("Resumed parked cart");
      } catch {
        toast.error("Could not load parked cart");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  // Prefill: SO cart first, then localStorage draft (walk-in survival). Parked handled above.
  useEffect(() => {
    if (resumeId) {
      setDraftReady(true);
      return;
    }

    let usedSoCart = false;

    if (soParam) setLinkedSo(soParam);
    if (kindParam === "on_order" || kindParam === "redo" || kindParam === "walk_in") {
      setBilling(
        kindParam === "on_order" ? "on_order" : kindParam === "redo" ? "redo" : "billable",
      );
    }

    // Seed garments from SO order cart (TicketKind right rail) — first priority
    if (kindParam === "on_order" || soParam) {
      const cart = readSoCart();
      const cartSos = cart?.sos?.length ? cart.sos : cart?.so ? [cart.so] : [];
      const soMatch =
        !soParam ||
        cart?.so === soParam ||
        cartSos.includes(soParam);
      if (cart && soMatch) {
        if (cart.so) setLinkedSo(cart.so);
        // Multi-SO label for header (primary kept for ERP link)
        if (cartSos.length > 1) {
          setLinkedSoLabel(`${cartSos.length} orders · ${cartSos.join(" · ")}`);
        } else {
          setLinkedSoLabel(null);
        }
        if (cart.customerId || cart.customerName) {
          setCustomer({
            id: cart.customerId || customerParam || undefined,
            name: cart.customerName || customerNameParam || "Client",
            phone: cart.customerPhone || "",
            email: cart.customerEmail || "",
          });
        } else if (customerParam && customerNameParam) {
          setCustomer({
            id: customerParam,
            name: customerNameParam,
            phone: "",
            email: "",
          });
        }
        const seeded = soCartToGarments(cart).map((g) => ({
          ref: g.ref,
          garmentType: g.garmentType,
          color: g.color,
          notes: g.notes,
          lines: g.lines as Line[],
          soItemKey: g.soItemKey,
          soItemName: g.soItemName,
        }));
        if (seeded.length) {
          setGarments(seeded);
          setActiveRef(seeded[0]?.ref ?? null);
          setExpectedGarments(seeded.length);
          setStep(1);
          toast.message(
            `${seeded.length} piece${seeded.length === 1 ? "" : "s"} from ${
              cartSos.length > 1 ? `${cartSos.length} orders` : "order cart"
            }`,
          );
          usedSoCart = true;
        }
        clearSoCart();
      }
    }

    if (!usedSoCart) {
      const draft = readIntakeDraft();
      if (intakeDraftHasWork(draft)) {
        const draftKind = draft!.kind;
        const urlKind = kindParam || null;
        const kindClash =
          urlKind &&
          draftKind &&
          urlKind !== draftKind &&
          !(urlKind === "warranty" && draftKind === "redo");
        if (!kindClash) {
          if (draft!.billing) setBilling(draft!.billing);
          if (draft!.linkedSo) setLinkedSo(draft!.linkedSo);
          if (draft!.origin && draft!.origin !== "NYC") {
            /* ignore legacy HOU drafts — origin locked NYC */
          }
          if (draft!.promiseDate) setPromiseDate(draft!.promiseDate);
          if (draft!.promiseTime) setPromiseTime(draft!.promiseTime);
          if (typeof draft!.isRush === "boolean") setIsRush(draft!.isRush);
          if (draft!.customer) setCustomer(draft!.customer);
          if (draft!.q) setQ(draft!.q);
          if (draft!.newName) setNewName(draft!.newName);
          if (draft!.newPhone) setNewPhone(draft!.newPhone);
          if (draft!.newEmail) setNewEmail(draft!.newEmail);
          if (draft!.newLine1) setNewLine1(draft!.newLine1);
          if (draft!.newLine2) setNewLine2(draft!.newLine2);
          if (draft!.newCity) setNewCity(draft!.newCity);
          if (draft!.newState) setNewState(draft!.newState);
          if (draft!.newZip) setNewZip(draft!.newZip);
          if (draft!.showNewForm) setShowNewForm(true);
          if (draft!.garments?.length) {
            setGarments(
              draft!.garments.map((g) => ({
                ...g,
                lines: (g.lines || []).map((l) => ({ ...l })),
              })),
            );
            setActiveRef(draft!.activeRef || draft!.garments[0]?.ref || null);
          }
          if (draft!.sellItems?.length) {
            setSellItems(draft!.sellItems.map((s) => ({ ...s })));
            const firstSell = draft!.sellItems[0]?.ref;
            if (draft!.activeRef?.startsWith("I") || (!draft!.garments?.length && firstSell)) {
              setActiveSellRef(draft!.activeRef?.startsWith("I") ? draft!.activeRef : firstSell || null);
            }
          }
          if (draft!.catalogMode === "sell" || draft!.catalogMode === "alter") {
            setCatalogMode(draft!.catalogMode);
          }
          if (typeof draft!.notifyReady === "boolean") setNotifyReady(draft!.notifyReady);
          if (draft!.ticketNote) setTicketNote(draft!.ticketNote);
          if (draft!.ticketNoteKind) setTicketNoteKind(draft!.ticketNoteKind);
          if (draft!.expectedGarments) setExpectedGarments(draft!.expectedGarments);
          if (draft!.parkLabel) setParkLabel(draft!.parkLabel);
          if (draft!.parkNote) setParkNote(draft!.parkNote);
          if (draft!.parkedCartId) setParkedCartId(draft!.parkedCartId);
          if (draft!.customDesc) setCustomDesc(draft!.customDesc);
          if (draft!.customPrice) setCustomPrice(draft!.customPrice);
          if (typeof draft!.step === "number") setStep(Math.min(3, Math.max(0, draft!.step)));
          toast.message("Restored unfinished intake", {
            description: "Recovered from a refresh or dropped connection.",
            action: {
              label: "Discard & start fresh",
              onClick: () => {
                clearIntakeDraft();
                window.location.reload();
              },
            },
          });
        }
      } else if (customerParam && customerNameParam) {
        setCustomer({
          id: customerParam,
          name: customerNameParam,
          phone: "",
          email: "",
        });
        setStep(1);
      } else if (customerNameParam && !customerParam) {
        setQ(customerNameParam);
      }
    }

    setDraftReady(true);
    // once per URL gate — not on garments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, customerParam, customerNameParam, soParam, kindParam]);

  // Prefer staff location once /api/me resolves — NYC-only, no-op (kept for draftReady gate).
  useEffect(() => {
    if (!draftReady || resumeId) return;
  }, [draftReady, resumeId]);

  // Persist intake to localStorage (debounced) — wifi drop / refresh safe
  useEffect(() => {
    if (!draftReady || resumeId) return;
    const t = window.setTimeout(() => {
      writeIntakeDraft({
        kind: kindParam || (billing === "on_order" ? "on_order" : billing === "redo" ? "redo" : "walk_in"),
        step,
        billing,
        linkedSo,
        origin,
        promiseDate,
        promiseTime,
        isRush,
        customer,
        q,
        newName,
        newPhone,
        newEmail,
        newLine1,
        newLine2,
        newCity,
        newState,
        newZip,
        showNewForm,
        garments,
        sellItems,
        catalogMode,
        activeRef: activeSellRef || activeRef,
        notifyReady,
        ticketNote,
        ticketNoteKind,
        expectedGarments,
        parkLabel,
        parkNote,
        parkedCartId,
        customDesc,
        customPrice,
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    draftReady,
    resumeId,
    kindParam,
    step,
    billing,
    linkedSo,
    origin,
    promiseDate,
    promiseTime,
    isRush,
    customer,
    q,
    newName,
    newPhone,
    newEmail,
    newLine1,
    newLine2,
    newCity,
    newState,
    newZip,
    showNewForm,
    garments,
    sellItems,
    catalogMode,
    activeRef,
    activeSellRef,
    notifyReady,
    ticketNote,
    ticketNoteKind,
    expectedGarments,
    parkLabel,
    parkNote,
    parkedCartId,
    customDesc,
    customPrice,
  ]);

  const allowSellMode = billing === "billable" && kindParam !== "on_order" && kindParam !== "redo" && kindParam !== "warranty" && kindParam !== "custom";
  const workTotal = useMemo(
    () => garments.reduce((s, g) => s + g.lines.reduce((a, l) => a + (Number(l.price) || 0), 0), 0),
    [garments],
  );
  const itemsTotal = useMemo(
    () => sellItems.reduce((s, it) => s + (Number(it.rate) || 0) * (Number(it.qty) || 1), 0),
    [sellItems],
  );
  const total = workTotal + itemsTotal;
  const lineCount = garments.reduce((s, g) => s + g.lines.length, 0) + sellItems.length;
  const active = garments.find((g) => g.ref === activeRef) ?? null;
  const activeSell = sellItems.find((s) => s.ref === activeSellRef) ?? null;

  const addGarment = (type: string) => {
    const ref = `G${garments.length + 1}`;
    const g: Garment = { ref, garmentType: type, color: "", notes: "", lines: [] };
    setGarments((prev) => [...prev, g]);
    setActiveRef(ref);
    setActiveSellRef(null);
    setSellDrawerOpen(false);
    setCartOpen(false);
    setExpectedGarments((n) => Math.max(n, garments.length + 1));
    setDrawerOpen(true);
    toast.success(`${type} added`);
  };

  const addSellItem = (item: SellableItem) => {
    if (item.availability === "out") return;
    const ref = `I${sellItems.length + 1}`;
    const colors = item.attributes?.Color || (item.color_label ? [item.color_label] : []);
    // Prefer ERP sizes; bottoms default 28–38 when API omitted attributes
    const sizes =
      item.attributes?.Size?.length
        ? item.attributes.Size
        : /jean|pant|chino|trouser|bermuda|short|bottom/i.test(`${item.item_group} ${item.item_name}`)
          ? ["28", "30", "32", "34", "36", "38"]
          : ["S", "M", "L", "XL"];
    const line: SellItem = {
      ref,
      item_code: item.item_code,
      item_name: item.item_name,
      color: item.color_label || colors[0] || "",
      size: sizes[0] || "",
      qty: 1,
      rate: Number(item.rate) || 0,
      availability: item.availability,
      eta: item.eta || (item.availability === "order" ? "Special order" : undefined),
      source: item.source,
      sizeOptions: sizes,
      colorOptions: colors,
    };
    setSellItems((prev) => [...prev, line]);
    setActiveSellRef(ref);
    setActiveRef(null);
    setDrawerOpen(false);
    setCartOpen(false);
    setSellDrawerOpen(true);
    toast.success(`${item.item_name} added`);
  };

  const openSellDrawer = (ref: string) => {
    setActiveSellRef(ref);
    setActiveRef(null);
    setDrawerOpen(false);
    setCartOpen(false);
    setSellDrawerOpen(true);
  };

  const closeSellDrawer = () => {
    setSellDrawerOpen(false);
  };

  /** Done on sell options — lock line into cart and keep the flow moving. */
  const finishSellDrawer = () => {
    const line = sellItems.find((s) => s.ref === activeSellRef);
    if (line) {
      const sizes = line.sizeOptions || [];
      if (sizes.length > 0 && !String(line.size || "").trim()) {
        toast.error("Pick a size");
        return;
      }
    }
    setSellDrawerOpen(false);
    // Phone has no always-visible rail — open cart sheet so Done feels finished.
    const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    if (phone && sellItems.length + garments.length > 0) {
      window.setTimeout(() => setCartOpen(true), 260);
    } else if (line) {
      toast.success(`${line.item_name} in cart`);
    }
  };

  const updateSellField = <K extends keyof SellItem>(ref: string, field: K, value: SellItem[K]) => {
    setSellItems((prev) => prev.map((s) => (s.ref === ref ? { ...s, [field]: value } : s)));
  };

  const removeSellItem = (ref: string) => {
    setSellItems((prev) => {
      const next = prev.filter((s) => s.ref !== ref).map((s, i) => ({ ...s, ref: `I${i + 1}` }));
      if (activeSellRef === ref) {
        setActiveSellRef(next[0]?.ref ?? null);
        if (!next.length) setSellDrawerOpen(false);
      } else if (activeSellRef) {
        const idx = prev.findIndex((s) => s.ref === activeSellRef);
        const removedIdx = prev.findIndex((s) => s.ref === ref);
        if (idx >= 0) {
          const adjusted = idx > removedIdx ? idx - 1 : idx;
          setActiveSellRef(next[Math.min(adjusted, next.length - 1)]?.ref ?? null);
        }
      }
      return next;
    });
  };

  const openGarmentDrawer = (ref: string) => {
    setActiveRef(ref);
    setActiveSellRef(null);
    setSellDrawerOpen(false);
    setCartOpen(false);
    setDrawerOpen(true);
  };

  const closeGarmentDrawer = () => {
    setDrawerOpen(false);
    setNoteOpenFor(null);
  };

  const openCartSheet = () => {
    setDrawerOpen(false);
    setSellDrawerOpen(false);
    setNoteOpenFor(null);
    setCartOpen(true);
  };

  const updateActiveGarmentField = (field: "color" | "notes", value: string) => {
    if (!activeRef) return;
    setGarments((prev) =>
      prev.map((g) => (g.ref === activeRef ? { ...g, [field]: value } : g)),
    );
  };

  /** Drop a piece from the ticket / order cart. Renumbers G1…Gn. */
  const removeGarment = (ref: string) => {
    setGarments((prev) => {
      const idx = prev.findIndex((g) => g.ref === ref);
      if (idx < 0) return prev;
      const removed = prev[idx];
      const next = prev
        .filter((g) => g.ref !== ref)
        .map((g, i) => ({ ...g, ref: `G${i + 1}` }));

      if (next.length === 0) {
        setActiveRef(null);
        setDrawerOpen(false);
      } else if (activeRef === ref) {
        const pick = Math.min(idx, next.length - 1);
        setActiveRef(next[pick]!.ref);
      } else {
        const activeIdx = prev.findIndex((g) => g.ref === activeRef);
        if (activeIdx >= 0) {
          const adjusted = activeIdx > idx ? activeIdx - 1 : activeIdx;
          setActiveRef(next[Math.min(adjusted, next.length - 1)]!.ref);
        }
      }

      toast.message(`Removed ${removed?.garmentType || ref}`);
      return next;
    });
    setExpectedGarments((n) => Math.max(0, n - 1));
  };

  const togglePreset = (p: Preset) => {
    if (!active) return;
    // SPEC 073 — never bill a group parent
    if (p.is_group === 1 || p.is_group === true) return;
    const label = (p.display_name || p.preset_name || p.id || "").trim();
    setGarments((prev) =>
      prev.map((g) => {
        if (g.ref !== active.ref) return g;
        const exists = g.lines.find((l) => l.presetId === p.id);
        if (exists) return { ...g, lines: g.lines.filter((l) => l.presetId !== p.id) };
        return {
          ...g,
          lines: [
            ...g.lines,
            {
              id: uid(),
              description: label,
              price: Number(p.price) || 0,
              estMinutes: p.est_minutes,
              presetId: p.id,
            },
          ],
        };
      }),
    );
  };

  const removeLine = (gRef: string, lineId: string) => {
    setGarments((prev) =>
      prev.map((g) => (g.ref === gRef ? { ...g, lines: g.lines.filter((l) => l.id !== lineId) } : g)),
    );
    if (noteOpenFor === lineId) setNoteOpenFor(null);
  };

  const addCustomLine = () => {
    if (!active) {
      toast.error("Pick a garment first");
      return;
    }
    const desc = customDesc.trim();
    const price = Number(customPrice.replace(/[^0-9.]/g, ""));
    if (!desc) {
      toast.error("Describe the work");
      return;
    }
    if (!(price > 0)) {
      toast.error("$0 custom line is almost always a mistake — use Re-do for free work");
      return;
    }
    setGarments((prev) =>
      prev.map((g) => {
        if (g.ref !== active.ref) return g;
        return {
          ...g,
          lines: [
            ...g.lines,
            {
              id: uid(),
              description: desc,
              price,
              // no presetId → custom; default minutes so ERP capacity script doesn't block summit
              estMinutes: 15,
            },
          ],
        };
      }),
    );
    setCustomDesc("");
    setCustomPrice("");
    toast.success("Custom line added");
  };

  const updateLineNotes = (gRef: string, lineId: string, notes: string) => {
    setGarments((prev) =>
      prev.map((g) =>
        g.ref !== gRef
          ? g
          : {
              ...g,
              lines: g.lines.map((l) => (l.id === lineId ? { ...l, notes } : l)),
            },
      ),
    );
  };

  const addLinePhoto = (gRef: string, lineId: string, file: File) => {
    const url = URL.createObjectURL(file);
    setGarments((prev) =>
      prev.map((g) =>
        g.ref !== gRef
          ? g
          : {
              ...g,
              lines: g.lines.map((l) =>
                l.id !== lineId
                  ? l
                  : {
                      ...l,
                      photoFiles: [...(l.photoFiles || []), file],
                      photoPreviewUrls: [...(l.photoPreviewUrls || []), url],
                    },
              ),
            },
      ),
    );
  };

  const addGarmentPhoto = (gRef: string, file: File) => {
    const url = URL.createObjectURL(file);
    setGarments((prev) =>
      prev.map((g) =>
        g.ref !== gRef
          ? g
          : {
              ...g,
              photoFiles: [...(g.photoFiles || []), file],
              photoPreviewUrls: [...(g.photoPreviewUrls || []), url],
            },
      ),
    );
    toast.success("Photo attached to garment");
  };

  const removeGarmentPhoto = (gRef: string, idx: number) => {
    setGarments((prev) =>
      prev.map((g) => {
        if (g.ref !== gRef) return g;
        const files = [...(g.photoFiles || [])];
        const urls = [...(g.photoPreviewUrls || [])];
        const doomed = urls[idx];
        if (doomed) URL.revokeObjectURL(doomed);
        files.splice(idx, 1);
        urls.splice(idx, 1);
        return { ...g, photoFiles: files, photoPreviewUrls: urls };
      }),
    );
  };

  const filteredPresets = useMemo(() => {
    const all = presets.data ?? [];
    if (!active) return all;
    return all.filter((p) => {
      const types = p.garment_types ?? (p.garment_type ? [p.garment_type] : ["All"]);
      return types.includes("All") || types.includes(active.garmentType) || !p.garment_type;
    });
  }, [presets.data, active]);

  const selectCustomer = async (c: CustomerHit) => {
    setCustomer(c);
    setShowNewForm(false);
    // hydrate phone/email/address from full record when possible
    if (c.id) {
      try {
        const d = await api.get<any>(`/api/intake-alterations/customers/${encodeURIComponent(c.id)}`);
        if (d) {
          const addr = d.address
            ? [d.address.line1, d.address.city, d.address.state, d.address.zip].filter(Boolean).join(", ")
            : "";
          setCustomer({
            id: d.id || c.id,
            name: d.name || c.name,
            phone: d.mobile || c.phone || "",
            email: d.email || c.email || "",
            addressLine: addr || c.addressLine || "",
          });
        }
      } catch {
        /* keep search hit */
      }
    }
    setStep(1);
  };

  const createCustomer = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Name is required");
      if (!newPhone.trim()) throw new Error("Mobile number is required");
      const body: Record<string, unknown> = {
        full_name: newName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
      };
      if (newLine1.trim() || newCity.trim()) {
        body.address = newLine1.trim();
        body.city = newCity.trim() || undefined;
        body.state = newState.trim() || undefined;
        body.zip_code = newZip.trim() || undefined;
        if (newLine2.trim()) body.address_line2 = newLine2.trim();
      }
      // Prefer intake path create via customers API
      const created = await api.post<any>("/api/customers", body);
      return created;
    },
    onSuccess: (created) => {
      const id = created?.id || created?.name;
      const name = created?.fullName || created?.customer_name || created?.name || newName.trim();
      const phone = created?.phone || newPhone.trim();
      const email = created?.email || newEmail.trim();
      const addr = [newLine1, newCity, newState, newZip].filter(Boolean).join(", ");
      setCustomer({
        id,
        name,
        phone,
        email,
        addressLine: addr || undefined,
      });
      setShowNewForm(false);
      toast.success("Customer saved to ERPNext");
      setStep(1);
    },
    onError: (e: Error) => toast.error(e.message || "Could not create customer"),
  });

  const buildTicketBody = () => {
    if (!customer && !newName.trim()) throw new Error("Pick or create a customer");
    if (garments.length === 0 && sellItems.length === 0) throw new Error("Add at least one garment or item");
    const alterWorkCount = garments.reduce((s, g) => s + g.lines.length, 0);
    if (alterWorkCount === 0 && sellItems.length === 0) {
      throw new Error("Add work lines or sell items");
    }
    // Every alter garment needs work — including warranty / on-order (valued lines).
    // Sell-only carts may have zero garments.
    if (garments.some((g) => g.lines.length === 0) && sellItems.length === 0) {
      throw new Error("Add work lines to each garment");
    }
    if (garments.some((g) => g.lines.length === 0) && sellItems.length > 0 && garments.length > 0) {
      throw new Error("Add work lines to each alter garment (or remove empty ones)");
    }

    const body: any = {
      origin,
      isRush,
      paymentMethod: "on_account",
      deposit: 0,
      due_date: promiseDate || undefined,
      promised_date: promiseDate || undefined,
      due_time: promiseTime || undefined,
      // Real idempotency key (not isPending). Same key on retry = same ticket.
      idempotency_key: submitIdempotencyKeyRef.current,
      garments: garments.map((g) => ({
        ref: g.ref,
        garmentType: g.garmentType,
        description: g.garmentType,
        color: g.color,
        notes: g.notes,
        lines: g.lines.map((l) => ({
          id: l.id,
          description: l.description,
          // Always keep full shop price — internal accounted value.
          // Non-billable (on_order / redo) never creates SI; billing_status gates books.
          price: l.price,
          estMinutes: l.estMinutes,
          // Lucia 030 — map to ERP line_notes (preset optional = custom line)
          notes: l.notes || undefined,
          preset: l.presetId || null,
        })),
      })),
      sellItems: sellItems.map((s) => ({
        item_code: s.item_code,
        item_name: s.item_name,
        qty: s.qty,
        rate: s.rate,
        color: s.color,
        size: s.size,
        availability: s.availability,
        eta: s.eta,
        source: s.source,
      })),
      billing_status:
        billing === "on_order" ? "Included in Custom Order" : billing === "redo" ? "Warranty" : "Billable",
      included_in_custom: billing === "on_order" ? 1 : 0,
      linked_sales_order: billing === "on_order" ? linkedSo || undefined : undefined,
    };
    // Delivery (3 options)
    body.delivery_method = delivery.delivery_method;
    if (delivery.delivery_method !== "Pickup") {
      body.delivery_scheduled = 1;
      if (delivery.delivery_requested_date) body.delivery_requested_date = delivery.delivery_requested_date;
      else if (promiseDate) body.delivery_requested_date = promiseDate;
      if (delivery.delivery_time_window) body.delivery_time_window = delivery.delivery_time_window;
      if (delivery.delivery_address) body.delivery_address = delivery.delivery_address;
      if (delivery.delivery_apt) body.delivery_apt = delivery.delivery_apt;
      body.delivery_city = delivery.delivery_city || "New York";
      body.delivery_state = delivery.delivery_state || "NY";
      if (delivery.delivery_zip) body.delivery_zip = delivery.delivery_zip;
      if (delivery.delivery_notes) body.delivery_notes = delivery.delivery_notes;
      if (delivery.delivery_fee_override) {
        body.delivery_fee_override = 1;
        body.delivery_fee = delivery.delivery_fee ?? 0;
        if (delivery.delivery_fee_override_reason) {
          body.delivery_fee_override_reason = delivery.delivery_fee_override_reason;
        }
      } else if (delivery.delivery_method === "Ship (FedEx)" && delivery.delivery_fee != null) {
        body.delivery_fee = delivery.delivery_fee;
      }
    }
    if (ticketNote.trim()) {
      if (ticketNoteKind === "customer") body.customer_notes = ticketNote.trim();
      else body.internal_notes = ticketNote.trim();
    }
    if (customer?.id) body.customer = { id: customer.id, name: customer.name };
    else
      body.newCustomer = {
        name: (customer?.name || newName).trim(),
        phone: customer?.phone || newPhone.trim(),
        email: customer?.email || newEmail.trim(),
      };
    return body;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!promiseDate || !promiseTime) {
        throw new Error("Pick a promised date and time");
      }
      const body = buildTicketBody();
      // Offline: queue the ticket body and keep draft — flush when online
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueueIntakeTicket(body, displayName || customer?.name || newName || "Walk-in");
        return { queuedOffline: true as const };
      }
      const res = await api.post<{
        ticketName: string;
        salesInvoice?: string | null;
        squarePaymentLink?: string | null;
        appPayUrl?: string | null;
        invoiceTotal?: number;
        sellWarnings?: string[];
      }>("/api/intake-alterations/tickets", body);
      const ticketName = res.ticketName;
      // Upload garment + line photos after ticket exists (Lucia 023 / 030)
      if (ticketName) {
        const uploads: Promise<unknown>[] = [];
        for (const g of garments) {
          for (const file of g.photoFiles || []) {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("path", `alts/${ticketName}/${g.ref}/intake-${Date.now()}-${file.name || "photo.jpg"}`);
            fd.append("ticketName", ticketName);
            fd.append("garmentRef", g.ref);
            uploads.push(
              api
                .raw("/api/intake-alterations/photos", { method: "POST", body: fd })
                .then(async (r) => {
                  if (!r.ok) {
                    const t = await r.text().catch(() => "");
                    throw new Error(t.slice(0, 120) || `photo upload ${r.status}`);
                  }
                }),
            );
          }
          g.lines.forEach((l, lineIdx) => {
            for (const file of l.photoFiles || []) {
              const fd = new FormData();
              fd.append("file", file);
              fd.append("path", `alts/${ticketName}/${g.ref}/${l.id}/${file.name || "photo.jpg"}`);
              fd.append("ticketName", ticketName);
              fd.append("garmentRef", g.ref);
              fd.append("lineRef", l.id);
              fd.append("lineIdx", String(lineIdx));
              uploads.push(
                api
                  .raw("/api/intake-alterations/photos", { method: "POST", body: fd })
                  .then(async (r) => {
                    if (!r.ok) {
                      const t = await r.text().catch(() => "");
                      throw new Error(t.slice(0, 120) || `photo upload ${r.status}`);
                    }
                  }),
              );
            }
          });
        }
        if (uploads.length) {
          const results = await Promise.allSettled(uploads);
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed) {
            console.error("[intake] photo upload failures", failed, "/", uploads.length);
            toast.error(`${failed} photo${failed === 1 ? "" : "s"} failed to upload — ticket still created`);
          }
        }
      }
      if (parkedCartId) {
        await api.delete(`/api/carts/${encodeURIComponent(parkedCartId)}`).catch(() => {});
      }
      return { ...res, queuedOffline: false as const };
    },
    onSuccess: (res) => {
      if ("queuedOffline" in res && res.queuedOffline) {
        toast.success("Saved offline — will send when wifi returns");
        // Keep draft; do not clear idempotency or hop to confirm
        return;
      }
      clearIntakeDraft();
      clearSoCart();
      // Rotate key only after a successful create so a future new ticket is distinct.
      submitIdempotencyKeyRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const inv = res.salesInvoice ? ` · ${res.salesInvoice}` : "";
      const tot =
        res.invoiceTotal != null && res.invoiceTotal > 0
          ? ` · $${Number(res.invoiceTotal).toFixed(2)}`
          : "";
      toast.success(
        res.squarePaymentLink || res.appPayUrl
          ? `Ticket ${res.ticketName} created${inv}${tot} — pay link ready`
          : `Ticket ${res.ticketName} created${inv}${tot}`,
      );
      if (res.sellWarnings?.length) {
        toast.warning(res.sellWarnings.join(" · "));
      }
      if (res.squarePaymentLink) {
        navigator.clipboard?.writeText(res.squarePaymentLink).catch(() => undefined);
      }
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
      // Stay on confirmation — SMS / email / print / checkout — not bare ticket hop
      setConfirmResult({
        ticketName: res.ticketName!,
        salesInvoice: res.salesInvoice ?? null,
        squarePaymentLink: res.squarePaymentLink ?? null,
        appPayUrl: res.appPayUrl ?? null,
        invoiceTotal: res.invoiceTotal ?? null,
        sellWarnings: res.sellWarnings,
      });
      setStep(4);
    },
    onError: (e: Error) => {
      // Network failure while "online" flag lies — queue if body buildable
      const msg = e.message || "";
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        try {
          const body = buildTicketBody();
          enqueueIntakeTicket(body, displayName || customer?.name || newName || "Walk-in");
          toast.success("Network drop — ticket queued offline");
          return;
        } catch {
          /* fall through */
        }
      }
      toast.error(e.message);
    },
  });

  const park = useMutation({
    mutationFn: async () => {
      const label = parkLabel.trim();
      if (label.length < 3) throw new Error("Label required — say what you’re waiting on");
      if (!customer && !newName.trim()) throw new Error("Customer required to park");

      const custName = customer?.name || newName.trim();
      const custPhone = customer?.phone || newPhone.trim();
      const custEmail = customer?.email || newEmail.trim();
      const expected = Math.max(expectedGarments, garments.length);

      const cartPayload = {
        garments: garments.map((g) => ({
          garmentId: g.ref,
          garmentType: g.garmentType,
          color: g.color,
          total: g.lines.reduce((s, l) => s + (Number(l.price) || 0), 0),
        })),
        lines: garments.flatMap((g) =>
          g.lines.map((l) => ({
            garmentRef: g.ref,
            preset: l.presetId || "",
            description: l.description,
            price: l.price,
          })),
        ),
        // resume extras (round-trip in cart_json)
        intake: {
          origin,
          billing,
          linkedSo,
          garments,
          sellItems,
          catalogMode,
          notifyReady,
          total,
          expectedGarmentCount: expected,
          remindAt: remindAtIso(remind),
          parkNote: parkNote.trim(),
          parkLabel: label,
          promiseDate,
          promiseTime,
          isRush,
          ticketNote: ticketNote.trim(),
          ticketNoteKind,
        },
      };

      return api.post<any>("/api/carts", {
        id: parkedCartId || undefined,
        location: origin,
        label,
        customer: {
          fullName: custName,
          name: custName,
          phone: custPhone,
          email: custEmail,
          address: newLine1
            ? { line1: newLine1, line2: newLine2, city: newCity, state: newState, zip: newZip }
            : undefined,
        },
        customerRef: customer?.id ?? null,
        cart: cartPayload,
      });
    },
    onSuccess: () => {
      // HER-62 P1-1: park must clear draft so next walk-in never restores prior customer.
      clearIntakeDraft();
      clearSoCart();
      toast.success("Parked — no ticket number burned");
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      nav("/parked");
    },
    onError: (e: Error) => toast.error(e.message || "Could not park"),
  });

  const openPark = () => {
    if (!customer && !newName.trim()) {
      toast.error("Select or create a customer first");
      setStep(0);
      return;
    }
    if (!parkLabel.trim()) {
      const base = customer?.name || newName.trim();
      setParkLabel(base ? `${base} — ` : "");
    }
    setExpectedGarments((n) => Math.max(n, garments.length || 1));
    setParkOpen(true);
  };

  const steps = confirmResult
    ? (["Customer", allowSellMode ? "Cart" : "Garments", "Review", "Schedule", "Done"] as const)
    : (["Customer", allowSellMode ? "Cart" : "Garments", "Review", "Schedule"] as const);
  const displayName = customer?.name || newName || "";

  const promiseLabel = useMemo(() => {
    if (!promiseDate) return null;
    try {
      const [y, m, d] = promiseDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const day = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      if (!promiseTime) return day;
      const [hh, mm] = promiseTime.split(":").map(Number);
      const ampm = hh >= 12 ? "PM" : "AM";
      const h12 = ((hh + 11) % 12) + 1;
      const t =
        promiseTime === "18:00" ? "EOD" : `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${ampm}`;
      return `${day} · ${t}`;
    } catch {
      return promiseDate;
    }
  }, [promiseDate, promiseTime]);

  const catalogModeSwitch = allowSellMode ? (
    <div className="flex w-full md:w-auto md:inline-flex p-0.5 rounded-full border border-brass/30 bg-black/35 mb-3 shrink-0">
      <button
        type="button"
        onClick={() => setCatalogMode("alter")}
        className={cn(
          "flex-1 md:flex-none h-11 md:h-9 px-4 rounded-full text-[10.5px] font-bold tracking-[0.14em] uppercase",
          catalogMode === "alter"
            ? "bg-brass/22 text-brass-light border border-brass/45"
            : "text-cream-dim hover:text-cream",
        )}
      >
        ◎ Alter
      </button>
      <button
        type="button"
        onClick={() => setCatalogMode("sell")}
        className={cn(
          "flex-1 md:flex-none h-11 md:h-9 px-4 rounded-full text-[10.5px] font-bold tracking-[0.14em] uppercase",
          catalogMode === "sell"
            ? "bg-brass/22 text-brass-light border border-brass/45"
            : "text-cream-dim hover:text-cream",
        )}
      >
        ◈ Sell
      </button>
    </div>
  ) : null;

  return (
    <div className="alts-root flex flex-col h-dvh max-h-dvh overflow-hidden">
      <header className="px-5 pt-4 pb-0 border-b border-brass/20 bg-black/20 backdrop-blur-xl sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <BrandSeal />
          <div>
            <div className="display text-lg">Alteration Intake</div>
            <div className="caps">
              {confirmResult
                ? `Ticket ${confirmResult.ticketName}`
                : billing === "billable"
                  ? "Client billable"
                  : billing === "on_order"
                    ? "On custom · valued · no SI"
                    : REDO_DISPLAY.intakeStrip}
              {!confirmResult && " · draft"}
            </div>
          </div>
          <div className="flex-1" />
          {customer && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="hidden md:flex items-center gap-2 rounded-full border border-brass/25 bg-black/25 px-3 py-1.5 hover:border-brass/45"
              title="Edit customer"
            >
              <span className="w-8 h-8 rounded-full bg-forest-raised border border-brass/30 grid place-items-center text-[12px] font-bold text-brass-light">
                {customer.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-left">
                <span className="block text-sm font-semibold leading-tight">{customer.name}</span>
                <span className="block text-[12px] text-cream-dim">
                  {[customer.phone, customer.email].filter(Boolean).join(" · ") || "Tap to edit details"}
                </span>
              </span>
            </button>
          )}
          <div className="flex items-center rounded-full border border-brass/20 bg-black/30 px-3 py-2 text-[12px] font-bold tracking-widest uppercase text-brass-light">
            NYC
          </div>
        </div>
        <div className="flex gap-0.5">
          {steps.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (confirmResult) return; // locked after submit
                if (i >= 2 && garments.length + sellItems.length < 1) {
                  toast.error(allowSellMode ? "Add a garment or item first" : "Add at least one garment first");
                  return;
                }
                if (i >= 1 && !customer && !newName.trim()) {
                  toast.error("Select a customer first");
                  return;
                }
                setDrawerOpen(false);
                setSellDrawerOpen(false);
                setCartOpen(false);
                setStep(i);
              }}
              disabled={!!confirmResult && i < 4}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-2 py-3.5 border-b-2 text-xs font-semibold tracking-widest uppercase transition-colors",
                i === step && "border-brass text-cream",
                i < step && "border-brass/35 text-cream-muted",
                i > step && "border-transparent text-cream-dim",
                confirmResult && i < 4 && "opacity-50",
              )}
            >
              <span
                className={cn(
                  "w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold",
                  i === step && "bg-brass text-forest-deep",
                  i < step && "bg-signal-emerald/90 text-forest-deep",
                  i > step && "bg-white/[0.07] text-cream-dim",
                )}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </header>

      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col",
          // step 1 catalog + step 3 promise each own their scroll/sticky CTA —
          // outer overflow-y-auto was clipping the finish button on phone
          step === 1 || step === 3 || step === 4
            ? "overflow-hidden px-5 py-6"
            : "overflow-y-auto px-5 py-6 pb-40",
        )}
      >
        {/* ── Customer ── */}
        {step === 0 && (
          <div className="max-w-3xl mx-auto space-y-5">
            <div>
              <h2 className="display text-[34px] leading-none">Who is this for?</h2>
              <p className="text-[12.5px] text-cream-dim mt-1.5">
                Search ERP customers, edit their contact & delivery address, or create new.
              </p>
            </div>

            <div className="flex gap-2 flex-wrap items-center">
              {(
                [
                  ["billable", "Billable"],
                  ["on_order", "On custom order"],
                  ["redo", "Re-do"],
                ] as const
              ).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBilling(k)}
                  className={cn(
                    "px-4 py-2.5 rounded-full text-xs font-bold tracking-wide uppercase border",
                    billing === k ? "bg-brass text-forest-deep border-brass" : "border-brass/30 text-cream-dim",
                  )}
                >
                  {lab}
                </button>
              ))}
              <Link to="/intake/kind" className="ml-auto text-[12px] font-bold tracking-widest uppercase text-brass-light">
                Change kind →
              </Link>
            </div>
            {linkedSo && billing === "on_order" && (
              <div className="card-glass px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
                <span className="caps text-[var(--vi,#9B8BC4)]">
                  {linkedSoLabel ? "Linked orders" : "Linked order"}
                </span>
                <span className="font-mono text-[var(--vi,#9B8BC4)] break-all">
                  {linkedSoLabel || linkedSo}
                </span>
                <span className="text-cream-dim text-xs">· full prices kept · no client invoice</span>
              </div>
            )}
            {billing === "redo" && (
              <div className="card-glass px-4 py-3 text-sm text-signal-emerald border-signal-emerald/30">
                {REDO_DISPLAY.intakeHelper}
              </div>
            )}

            {customer ? (
              <SelectedCustomerCard
                name={customer.name}
                phone={customer.phone}
                email={customer.email}
                addressLine={customer.addressLine}
                onEdit={customer.id ? () => setEditOpen(true) : undefined}
                onProfile={customer.id ? () => nav(`/customers/${encodeURIComponent(customer.id!)}`) : undefined}
                onChange={() => {
                  setCustomer(null);
                  setQ("");
                }}
              />
            ) : (
              <>
                <div className="relative">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Name, phone, or email…"
                    className="w-full h-[74px] rounded-2xl bg-black/35 border border-brass/30 pl-5 pr-4 text-[19px] text-cream outline-none focus:border-brass focus:shadow-[0_0_0_3px_rgba(176,141,87,0.14)] placeholder:text-cream-dim"
                    autoFocus
                  />
                </div>
                <p className="text-[12px] text-cream-dim">
                  Matches <b className="text-brass-light font-semibold">name · mobile · email</b> in ERPNext
                </p>

                <div className="space-y-2">
                  {(search.data ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left card-glass px-4 py-3.5 flex items-center gap-3.5 hover:border-brass/50"
                    >
                      <span className="w-[46px] h-[46px] rounded-full bg-forest-raised border border-brass/30 grid place-items-center display text-[17px] text-brass-light">
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-base">{c.name}</span>
                        <span className="text-[12px] text-cream-dim flex flex-wrap gap-x-2">
                          <span>{c.phone || "No phone"}</span>
                          {c.email ? <span>· {c.email}</span> : null}
                          {c.addressLine ? <span>· {c.addressLine}</span> : null}
                        </span>
                      </span>
                      <span className="text-brass-light text-sm">Select →</span>
                    </button>
                  ))}
                </div>

                {!showNewForm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewForm(true);
                      if (q.trim() && !newName) setNewName(q.trim());
                    }}
                    className="w-full flex items-center gap-3.5 p-4 rounded-[15px] border border-dashed border-brass/40 hover:bg-brass/10 text-left"
                  >
                    <span className="w-[46px] h-[46px] rounded-xl border border-brass/40 grid place-items-center text-brass-light text-2xl">
                      +
                    </span>
                    <span>
                      <span className="block font-semibold">New customer</span>
                      <span className="text-[12px] text-cream-dim">Name, mobile, email, delivery address</span>
                    </span>
                  </button>
                ) : (
                  <div className="card-glass p-5 space-y-3">
                    <div className="display text-[21px]">New customer</div>
                    <p className="text-[12px] text-cream-dim -mt-1 mb-1">
                      Saved to ERPNext before intake continues — so delivery has phone, email, and address.
                    </p>
                    <label className="block">
                      <span className="caps mb-1.5 block">
                        Full name <em className="text-[var(--ro)] not-italic">*</em>
                      </span>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                        placeholder="James Bennett"
                      />
                    </label>
                    <label className="block">
                      <span className="caps mb-1.5 block">
                        Mobile <em className="text-[var(--ro)] not-italic">*</em>
                      </span>
                      <input
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        type="tel"
                        className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                        placeholder="+1 917 555 0142"
                      />
                    </label>
                    <label className="block">
                      <span className="caps mb-1.5 block">Email</span>
                      <input
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        type="email"
                        className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                        placeholder="client@example.com"
                      />
                    </label>
                    <div className="pt-2 border-t border-brass/15">
                      <div className="caps mb-2 text-brass-light">Delivery address</div>
                      <label className="block mb-3">
                        <span className="caps mb-1.5 block">Street line 1</span>
                        <input
                          value={newLine1}
                          onChange={(e) => setNewLine1(e.target.value)}
                          className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                          placeholder="123 E 61st St"
                        />
                      </label>
                      <label className="block mb-3">
                        <span className="caps mb-1.5 block">Street line 2</span>
                        <input
                          value={newLine2}
                          onChange={(e) => setNewLine2(e.target.value)}
                          className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                          placeholder="Apt / floor"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <label className="block">
                          <span className="caps mb-1.5 block">City</span>
                          <input
                            value={newCity}
                            onChange={(e) => setNewCity(e.target.value)}
                            className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                            placeholder="New York"
                          />
                        </label>
                        <label className="block">
                          <span className="caps mb-1.5 block">State</span>
                          <input
                            value={newState}
                            onChange={(e) => setNewState(e.target.value)}
                            className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                            placeholder="NY"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="caps mb-1.5 block">ZIP</span>
                        <input
                          value={newZip}
                          onChange={(e) => setNewZip(e.target.value)}
                          className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-cream outline-none focus:border-brass"
                          placeholder="10065"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={!newName.trim() || !newPhone.trim() || createCustomer.isPending}
                        onClick={() => createCustomer.mutate()}
                        className="btn-brass flex-1 h-14 text-[12px] disabled:opacity-40"
                      >
                        {createCustomer.isPending ? "Saving…" : "Save & continue →"}
                      </button>
                      <button type="button" onClick={() => setShowNewForm(false)} className="btn-ghost h-14 px-4 text-[12px]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {customer && (
              <button type="button" onClick={() => setStep(1)} className="btn-brass h-14 px-8 text-[12px]">
                Continue to cart →
              </button>
            )}
          </div>
        )}

        {/* ── Cart: catalog + cart + drawer (SPEC 053 + 057 Sell) ── */}
        {step === 1 && (
          <div className="relative flex flex-1 min-h-0 -mx-5 -my-6 overflow-hidden">
            {catalogMode === "sell" && allowSellMode ? (
              <SellItemCatalog
                firstName={(displayName || "them").split(" ")[0] || "them"}
                items={sellable.data?.items ?? []}
                loading={sellable.isLoading}
                seeded={sellable.data?.seeded}
                filter={sellFilter}
                onFilter={setSellFilter}
                query={sellQuery}
                onQuery={setSellQuery}
                cartCounts={sellItems.reduce(
                  (acc, s) => {
                    acc[s.item_code] = (acc[s.item_code] || 0) + s.qty;
                    return acc;
                  },
                  {} as Record<string, number>,
                )}
                onAdd={addSellItem}
                modeSwitch={catalogModeSwitch}
              />
            ) : (
              <GarmentCatalog
                firstName={(displayName || "they").split(" ")[0] || "they"}
                types={GARMENT_TYPES}
                garments={garments}
                filter={catalogFilter}
                onFilter={setCatalogFilter}
                onAdd={addGarment}
                icon={garmentIcon}
                title={
                  allowSellMode
                    ? `What are we doing for ${(displayName || "them").split(" ")[0] || "them"}?`
                    : undefined
                }
                lede={
                  allowSellMode
                    ? "Alter client garments, or switch to Sell for stock / special-order."
                    : undefined
                }
                modeSwitch={catalogModeSwitch}
              />
            )}
            <TicketCartRail
              garments={garments}
              sellItems={allowSellMode ? sellItems.map((s) => ({ ...s, kind: "sell" as const })) : []}
              activeRef={activeSellRef || activeRef}
              workTotal={workTotal}
              itemsTotal={allowSellMode ? itemsTotal : 0}
              showSellChrome={allowSellMode}
              onSelect={(ref) => {
                if (ref.startsWith("I")) openSellDrawer(ref);
                else openGarmentDrawer(ref);
              }}
              onEdit={(ref) => {
                if (ref.startsWith("I")) openSellDrawer(ref);
                else openGarmentDrawer(ref);
              }}
              onRemove={(ref) => {
                if (ref.startsWith("I")) {
                  removeSellItem(ref);
                  if (activeSellRef === ref) closeSellDrawer();
                } else {
                  removeGarment(ref);
                  if (activeRef === ref) closeGarmentDrawer();
                }
              }}
              onAddOther={() => {
                setCatalogMode("alter");
                addGarment("Other");
              }}
              onContinue={() => {
                if (garments.length + sellItems.length < 1) {
                  toast.error(allowSellMode ? "Add a garment or item" : "Add at least one garment");
                  return;
                }
                closeGarmentDrawer();
                closeSellDrawer();
                setStep(2);
              }}
              onPark={openPark}
              icon={garmentIcon}
            />
            <GarmentOptionsDrawer
              open={drawerOpen && !sellDrawerOpen}
              garment={active}
              presets={filteredPresets}
              presetsLoading={presets.isLoading}
              customDesc={customDesc}
              customPrice={customPrice}
              noteOpenFor={noteOpenFor}
              onClose={closeGarmentDrawer}
              onRemovePiece={() => {
                if (!active) return;
                const ref = active.ref;
                removeGarment(ref);
                closeGarmentDrawer();
              }}
              onColor={(v) => updateActiveGarmentField("color", v)}
              onNotes={(v) => updateActiveGarmentField("notes", v)}
              onTogglePreset={togglePreset}
              onRemoveLine={(lineId) => active && removeLine(active.ref, lineId)}
              onCustomDesc={setCustomDesc}
              onCustomPrice={setCustomPrice}
              onAddCustom={addCustomLine}
              onNoteOpen={setNoteOpenFor}
              onLineNotes={(lineId, notes) => active && updateLineNotes(active.ref, lineId, notes)}
              onLinePhoto={(lineId, file) => active && addLinePhoto(active.ref, lineId, file)}
              icon={garmentIcon}
              photoStrip={
                active ? (
                  <GarmentPhotoStrip
                    large
                    garment={active}
                    onAdd={(file) => addGarmentPhoto(active.ref, file)}
                    onRemove={(idx) => removeGarmentPhoto(active.ref, idx)}
                  />
                ) : null
              }
            />
            {allowSellMode && (
              <SellItemDrawer
                open={sellDrawerOpen}
                line={activeSell}
                sizes={activeSell?.sizeOptions || []}
                colors={activeSell?.colorOptions || []}
                onClose={closeSellDrawer}
                onDone={finishSellDrawer}
                onRemove={() => {
                  if (!activeSell) return;
                  removeSellItem(activeSell.ref);
                  closeSellDrawer();
                }}
                onColor={(v) => activeSell && updateSellField(activeSell.ref, "color", v)}
                onSize={(v) => activeSell && updateSellField(activeSell.ref, "size", v)}
                onQty={(n) => activeSell && updateSellField(activeSell.ref, "qty", n)}
                onRate={(n) => activeSell && updateSellField(activeSell.ref, "rate", n)}
                onEta={(v) => activeSell && updateSellField(activeSell.ref, "eta", v)}
              />
            )}
            <TicketCartDock
              lineCount={garments.length + sellItems.length}
              workTotal={workTotal}
              itemsTotal={allowSellMode ? itemsTotal : 0}
              showBreak={allowSellMode}
              summary={
                garments.length + sellItems.length === 0
                  ? "Empty"
                  : [
                      garments[0] ? `${garments[0].garmentType}` : "",
                      sellItems[0] ? sellItems[0].item_name : "",
                      garments.length + sellItems.length > 1
                        ? `+${garments.length + sellItems.length - 1}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
              }
              onOpen={openCartSheet}
            />
          </div>
        )}

        {/* ── Review ── */}
        {step === 2 && (
          <div className="max-w-2xl mx-auto">
            {customer && (
              <div className="mb-5">
                <SelectedCustomerCard
                  name={customer.name}
                  phone={customer.phone}
                  email={customer.email}
                  addressLine={customer.addressLine}
                  onEdit={customer.id ? () => setEditOpen(true) : undefined}
                  onProfile={customer.id ? () => nav(`/customers/${encodeURIComponent(customer.id!)}`) : undefined}
                />
              </div>
            )}
            <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
              <h2 className="display text-[34px] leading-none">
                Read it back to {(displayName || "the client").split(" ")[0]}
              </h2>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[12px] font-bold tracking-widest uppercase text-brass-light"
              >
                ← Edit cart
              </button>
            </div>
            <p className="text-[12.5px] text-cream-dim mb-5">Confirm the work — next you pick the promised date & time.</p>
            <div className="card-glass overflow-hidden">
              {garments.map((g) => (
                <div key={g.ref}>
                  <div className="flex items-center gap-2.5 px-5 py-3.5 bg-black/25 border-b border-brass/15">
                    <span className="chip bg-brass text-forest-deep border-brass">{g.ref}</span>
                    <span className="font-semibold text-[13.5px]">
                      {g.garmentType}
                      {g.color ? ` — ${g.color}` : ""}
                    </span>
                    <span className="ml-auto display text-xl text-brass-light">
                      {money(g.lines.reduce((s, l) => s + l.price, 0))}
                    </span>
                  </div>
                  {(g.photoPreviewUrls || []).length > 0 && (
                    <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-brass/10 bg-black/15">
                      {(g.photoPreviewUrls || []).map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt=""
                          className="w-14 h-14 rounded-lg object-cover border border-brass/30"
                        />
                      ))}
                      <span className="self-center text-[12px] text-cream-dim">
                        {(g.photoPreviewUrls || []).length} photo
                        {(g.photoPreviewUrls || []).length === 1 ? "" : "s"} · uploads on submit
                      </span>
                    </div>
                  )}
                  {g.lines.map((l) => (
                    <div key={l.id} className="flex flex-col gap-1 px-5 py-3.5 border-b border-brass/10 text-[13.5px]">
                      <div className="flex items-center gap-3">
                        <span className="flex-1 text-cream-muted">
                          {l.description}
                          {!l.presetId ? (
                            <span className="ml-2 text-[7.5px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-signal-amber/50 text-signal-amber">
                              custom
                            </span>
                          ) : null}
                        </span>
                        <span className="font-semibold tabular-nums">{money(l.price)}</span>
                        <button type="button" className="w-10 h-10 rounded-[10px] bg-white/[0.04] text-cream-dim" onClick={() => removeLine(g.ref, l.id)}>
                          ✕
                        </button>
                      </div>
                      {l.notes?.trim() ? (
                        <p className="text-[12px] text-cream-dim border-l border-brass/40 ml-0.5 pl-2">{l.notes}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
              {sellItems.map((s) => {
                const amt = (Number(s.rate) || 0) * (Number(s.qty) || 1);
                const sub = [s.color, s.size ? `sz ${s.size}` : "", s.qty > 1 ? `×${s.qty}` : "", s.availability === "order" ? s.eta || "special order" : ""]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={s.ref} className="border-b border-brass/10 last:border-b-0">
                    <div className="flex items-center gap-2.5 px-5 py-3.5 bg-black/25">
                      <span className="chip border-[rgba(79,191,142,0.45)] bg-[rgba(79,191,142,0.12)] text-[var(--em,#4FBF8E)]">
                        {s.ref}
                      </span>
                      <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-[rgba(79,191,142,0.4)] text-[var(--em,#4FBF8E)] bg-[rgba(79,191,142,0.1)]">
                        Sell
                      </span>
                      <span className="font-semibold text-[13.5px] min-w-0 flex-1 truncate">{s.item_name}</span>
                      <span className="ml-auto display text-xl text-brass-light flex-none">{money(amt)}</span>
                    </div>
                    <div className="flex items-center gap-3 px-5 py-3 text-[13px]">
                      <span className="flex-1 text-cream-muted">{sub || s.item_code}</span>
                      <button
                        type="button"
                        className="text-[11px] font-bold tracking-wider uppercase text-brass-light"
                        onClick={() => {
                          setStep(1);
                          setCatalogMode("sell");
                          openSellDrawer(s.ref);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="w-10 h-10 rounded-[10px] bg-white/[0.04] text-cream-dim"
                        onClick={() => removeSellItem(s.ref)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              {ticketNote.trim() ? (
                <p className="text-xs text-cream-dim px-5 py-3 border-t border-brass/15">
                  <span className="caps text-brass">{ticketNoteKind === "customer" ? "On receipt" : "Internal"} · </span>
                  {ticketNote.trim()}
                </p>
              ) : null}
              {billing !== "billable" && (
                <p className="text-xs text-signal-amber px-5 py-3">
                  {billing === "on_order"
                    ? "On custom order — full prices kept for value; no client invoice."
                    : "Re-do — full prices kept for value; no SI / no AR."}
                </p>
              )}
              {allowSellMode && sellItems.length > 0 && (
                <div className="flex items-baseline justify-between px-5 py-3.5 border-t border-brass/20 bg-black/20">
                  <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-cream-dim">
                    Work {money(workTotal)} · Items {money(itemsTotal)}
                  </span>
                  <span className="display text-2xl text-brass-light font-semibold">{money(total)}</span>
                </div>
              )}
            </div>
            <div className="mt-5 rounded-[17px] border border-brass/25 bg-black/25 p-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="display text-[19px] italic flex-1">Ticket note</span>
                <div className="flex rounded-lg overflow-hidden border border-brass/30">
                  <button
                    type="button"
                    onClick={() => setTicketNoteKind("internal")}
                    className={cn(
                      "px-3 py-1.5 text-[12px] font-bold tracking-wider uppercase",
                      ticketNoteKind === "internal" ? "bg-brass/20 text-brass-light" : "text-cream-dim",
                    )}
                  >
                    Internal
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicketNoteKind("customer")}
                    className={cn(
                      "px-3 py-1.5 text-[12px] font-bold tracking-wider uppercase",
                      ticketNoteKind === "customer" ? "bg-brass/20 text-brass-light" : "text-cream-dim",
                    )}
                  >
                    On the receipt
                  </button>
                </div>
              </div>
              <textarea
                value={ticketNote}
                onChange={(e) => setTicketNote(e.target.value)}
                placeholder="Anything about this ticket as a whole — client travelling Thursday, fabric fragile…"
                rows={3}
                className="w-full rounded-[13px] bg-black/40 border border-brass/30 px-4 py-3 text-[13px] text-cream-muted resize-none placeholder:text-cream-dim"
              />
            </div>
            <button
              type="button"
              onClick={() => setNotifyReady((v) => !v)}
              className={cn(
                "mt-4 w-full card-glass px-4 py-4 flex items-center gap-3 text-left",
                notifyReady && "border-signal-amber/50 bg-signal-amber/10",
              )}
            >
              <span className="text-lg">✉</span>
              <span className="flex-1">
                <span className="block font-semibold text-[13px]">Text when ready</span>
                <span className="text-[12px] text-cream-dim">
                  SMS to {customer?.phone || newPhone || "phone on file"}
                </span>
              </span>
              <span className={cn("w-12 h-7 rounded-full p-1 transition-colors", notifyReady ? "bg-signal-amber/80" : "bg-white/10")}>
                <span className={cn("block w-5 h-5 rounded-full bg-cream transition-transform", notifyReady && "translate-x-5")} />
              </span>
            </button>
          </div>
        )}

        {/* ── Schedule (SPEC 058) — last step before write ── */}
        {step === 3 && !confirmResult && (
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
            <DeliveryBlock
              value={delivery}
              onChange={setDelivery}
              dueDate={promiseDate || undefined}
              freeCustom={billing === "on_order"}
              canOverrideFee={me?.role === "super_admin" || me?.role === "store_manager"}
            />
            <PromiseSchedule
              origin={origin}
              days={scheduleLoad.data?.days ?? []}
              loading={scheduleLoad.isLoading}
              selectedDate={promiseDate}
              selectedTime={promiseTime}
              isRush={isRush}
              clientLabel={displayName}
              onSelectDate={(d) => {
                setPromiseDate(d);
                if (!promiseTime) setPromiseTime("18:00");
                if (delivery.delivery_method !== "Pickup" && !delivery.delivery_requested_date) {
                  setDelivery((prev) => ({ ...prev, delivery_requested_date: d }));
                }
              }}
              onSelectTime={setPromiseTime}
              onRush={setIsRush}
              onBack={() => setStep(2)}
              confirming={create.isPending}
              onConfirm={() => {
                if (!promiseDate || !promiseTime) {
                  toast.error("Pick a promised date and time");
                  return;
                }
                if (delivery.delivery_method === "Hand Delivery") {
                  const z = (delivery.delivery_zip || "").replace(/\D/g, "");
                  if (z.length !== 5) {
                    toast.error("Hand delivery needs a 5-digit ZIP");
                    return;
                  }
                  if (!delivery.delivery_address?.trim()) {
                    toast.error("Enter delivery street address");
                    return;
                  }
                }
                if (delivery.delivery_method === "Ship (FedEx)" && billing === "billable") {
                  if (delivery.delivery_fee == null || Number(delivery.delivery_fee) < 0) {
                    toast.error("Enter FedEx fee (or 0 if complimentary)");
                    return;
                  }
                }
                if (
                  delivery.delivery_fee_override &&
                  delivery.delivery_method === "Hand Delivery" &&
                  billing === "billable"
                ) {
                  if (!String(delivery.delivery_fee_override_reason || "").trim()) {
                    toast.error("Manager override needs a reason");
                    return;
                  }
                }
                create.mutate();
              }}
            />
          </div>
        )}

        {/* ── Confirmation — SMS / email / print / checkout ── */}
        {step === 4 && confirmResult && (
          <div className="flex-1 min-h-0 flex flex-col -mx-5 -my-6">
            <IntakeConfirm
              result={confirmResult}
              clientName={displayName || "Client"}
              clientPhone={customer?.phone || newPhone || null}
              clientEmail={customer?.email || newEmail || null}
              pieceCount={garments.length}
              totalLabel={money(total)}
              billing={billing}
              promiseLabel={promiseLabel}
            />
          </div>
        )}
      </div>

      {/* sticky bar — cart uses rail/dock; schedule + confirm have own CTAs */}
      {step !== 1 && step !== 3 && step !== 4 && (
      <div className="fixed bottom-0 inset-x-0 z-40 px-5 py-4 border-t border-brass/25 bg-gradient-to-b from-forest-deep/55 to-forest-deep/97 backdrop-blur-xl flex items-center gap-4">
        <button
          type="button"
          onClick={openCartSheet}
          className="flex items-center gap-3.5 min-w-0 rounded-[14px] border border-brass/25 bg-white/[0.04] pl-2 pr-4 py-2"
        >
          <span className="relative w-[46px] h-[46px] rounded-xl border border-brass/20 bg-black/30 grid place-items-center text-brass-light">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 8h16l-1.2 12H5.2L4 8Z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] rounded-full bg-brass text-forest-deep text-[12px] font-bold grid place-items-center">
              {garments.length + sellItems.length}
            </span>
          </span>
          <span className="text-left">
            <span className="caps block">Ticket total</span>
            <span className="display text-[26px] text-brass-light leading-none">{money(total)}</span>
          </span>
        </button>
        <div className="flex-1" />
        <button type="button" onClick={openPark} className="btn-ghost h-[74px] px-6 text-[12px] hidden sm:inline-flex items-center">
          Park
        </button>
        {step === 2 ? (
          <button
            type="button"
            onClick={() => {
              if (garments.length + sellItems.length === 0) {
                toast.error(allowSellMode ? "Add a garment or item" : "Add at least one garment");
                return;
              }
              if (!customer && !newName.trim()) {
                toast.error("Pick or create a customer");
                return;
              }
              setStep(3);
            }}
            disabled={garments.length + sellItems.length === 0 || (!customer && !newName.trim())}
            className="btn-brass h-[74px] px-8 text-[13px] disabled:opacity-40 shadow-[0_12px_34px_rgba(176,141,87,0.25)]"
          >
            Promise date & time →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep(Math.min(2, step + 1))}
            className="btn-brass h-[74px] px-8 text-[13px]"
          >
            Continue →
          </button>
        )}
      </div>
      )}

      {/* Ticket cart: phone bottom sheet, desktop right slide-out */}
      <TicketCartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        garments={garments}
        sellItems={allowSellMode ? sellItems : []}
        workTotal={workTotal}
        itemsTotal={allowSellMode ? itemsTotal : 0}
        showSellChrome={allowSellMode}
        showContinue={step === 1}
        icon={garmentIcon}
        onEdit={(ref) => {
          setCartOpen(false);
          if (ref.startsWith("I")) openSellDrawer(ref);
          else openGarmentDrawer(ref);
        }}
        onRemove={(ref) => {
          if (ref.startsWith("I")) {
            removeSellItem(ref);
            if (activeSellRef === ref) closeSellDrawer();
          } else {
            removeGarment(ref);
            if (activeRef === ref) closeGarmentDrawer();
          }
        }}
        onContinue={() => {
          if (garments.length + sellItems.length < 1) {
            toast.error(allowSellMode ? "Add a garment or item" : "Add at least one garment");
            return;
          }
          setCartOpen(false);
          closeGarmentDrawer();
          closeSellDrawer();
          setStep(2);
        }}
        onPark={() => {
          setCartOpen(false);
          openPark();
        }}
        onAddOther={
          step === 1
            ? () => {
                setCartOpen(false);
                setCatalogMode("alter");
                addGarment("Other");
              }
            : undefined
        }
      />

      <ParkDrawer
        open={parkOpen}
        onClose={() => setParkOpen(false)}
        label={parkLabel}
        onLabelChange={setParkLabel}
        note={parkNote}
        onNoteChange={setParkNote}
        expectedGarments={expectedGarments}
        onExpectedChange={setExpectedGarments}
        remind={remind}
        onRemindChange={setRemind}
        garments={garments}
        total={total}
        customerName={displayName}
        parking={park.isPending}
        onPark={() => park.mutate()}
        onSubmitAnyway={() => {
          setParkOpen(false);
          create.mutate();
        }}
        submitting={create.isPending}
      />

      {customer?.id && (
        <CustomerEditSheet
          open={editOpen}
          customerId={customer.id}
          customerName={customer.name}
          onClose={() => setEditOpen(false)}
          onSaved={(d) => {
            setCustomer({
              id: d.id,
              name: d.name,
              phone: d.phone,
              email: d.email,
              addressLine: d.addressLine,
            });
          }}
        />
      )}
    </div>
  );
}
