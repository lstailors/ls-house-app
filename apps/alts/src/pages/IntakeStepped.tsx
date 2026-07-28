import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
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

type Preset = {
  id: string;
  preset_name: string;
  garment_type?: string;
  garment_types?: string[];
  price: number;
  est_minutes?: number | null;
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
  const [origin, setOrigin] = useState<"NYC" | "HOU">("NYC");
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
  const [billing, setBilling] = useState<"billable" | "on_order" | "redo">(initialBilling);
  const [linkedSo, setLinkedSo] = useState<string | null>(soParam);

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
        if (intake.origin === "HOU" || intake.origin === "NYC") setOrigin(intake.origin);
        if (intake.billing) setBilling(intake.billing);
        if (intake.linkedSo) setLinkedSo(intake.linkedSo);
        if (Array.isArray(intake.garments)) {
          setGarments(intake.garments);
          setActiveRef(intake.garments[0]?.ref ?? null);
        }
        if (typeof intake.notifyReady === "boolean") setNotifyReady(intake.notifyReady);
        if (intake.expectedGarmentCount) setExpectedGarments(Number(intake.expectedGarmentCount) || 0);
        if (cart.label) setParkLabel(cart.label);
        setStep(intake.garments?.length ? 2 : 1);
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
      if (cart && (!soParam || cart.so === soParam)) {
        if (cart.so) setLinkedSo(cart.so);
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
          setStep(2);
          toast.message(`${seeded.length} piece${seeded.length === 1 ? "" : "s"} from order cart`);
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

  // Persist intake to localStorage (debounced) — wifi drop / refresh safe
  useEffect(() => {
    if (!draftReady || resumeId) return;
    const t = window.setTimeout(() => {
      writeIntakeDraft({
        kind: kindParam || (billing === "on_order" ? "on_order" : billing === "redo" ? "redo" : "walk_in"),
        step,
        billing,
        linkedSo,
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
        activeRef,
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
    activeRef,
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

  const total = useMemo(
    () => garments.reduce((s, g) => s + g.lines.reduce((a, l) => a + (Number(l.price) || 0), 0), 0),
    [garments],
  );
  const lineCount = garments.reduce((s, g) => s + g.lines.length, 0);
  const active = garments.find((g) => g.ref === activeRef) ?? garments[0] ?? null;

  const addGarment = (type: string) => {
    const ref = `G${garments.length + 1}`;
    const g: Garment = { ref, garmentType: type, color: "", notes: "", lines: [] };
    setGarments((prev) => [...prev, g]);
    setActiveRef(ref);
    setExpectedGarments((n) => Math.max(n, garments.length + 1));
    toast.success(`${type} added`);
    if (step < 2) setStep(2);
  };

  const togglePreset = (p: Preset) => {
    if (!active) return;
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
              description: p.preset_name,
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
              // no presetId → custom
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
    if (garments.length === 0) throw new Error("Add at least one garment");
    if (lineCount === 0 && billing === "billable") throw new Error("Add work lines");

    const body: any = {
      origin,
      isRush: false,
      paymentMethod: "on_account",
      deposit: 0,
      garments: garments.map((g) => ({
        ref: g.ref,
        garmentType: g.garmentType,
        description: g.garmentType,
        color: g.color,
        notes: g.notes,
        lines: g.lines.map((l) => ({
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
      billing_status:
        billing === "on_order" ? "Included in Custom Order" : billing === "redo" ? "Warranty" : "Billable",
      included_in_custom: billing === "on_order" ? 1 : 0,
      linked_sales_order: billing === "on_order" ? linkedSo || undefined : undefined,
    };
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
      const body = buildTicketBody();
      const res = await api.post<{ ticketName: string }>("/api/intake-alterations/tickets", body);
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
          for (const l of g.lines) {
            for (const file of l.photoFiles || []) {
              const fd = new FormData();
              fd.append("file", file);
              fd.append("path", `alts/${ticketName}/${g.ref}/${l.id}/${file.name || "photo.jpg"}`);
              fd.append("ticketName", ticketName);
              fd.append("garmentRef", g.ref);
              fd.append("lineRef", l.id);
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
          }
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
      return res;
    },
    onSuccess: (res) => {
      clearIntakeDraft();
      clearSoCart();
      toast.success(`Ticket ${res.ticketName} created`);
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
      nav(`/orders/alterations/${res.ticketName}`);
    },
    onError: (e: Error) => toast.error(e.message),
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
          notifyReady,
          total,
          expectedGarmentCount: expected,
          remindAt: remindAtIso(remind),
          parkNote: parkNote.trim(),
          parkLabel: label,
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

  const steps = ["Customer", "Garments", "Work", "Review"] as const;
  const displayName = customer?.name || newName || "";

  return (
    <div className="alts-root flex flex-col min-h-screen">
      <header className="px-5 pt-4 pb-0 border-b border-brass/20 bg-black/20 backdrop-blur-xl sticky top-0 z-30">
        <div className="flex items-center gap-3 mb-3">
          <Link to="/" className="seal">
            LS
          </Link>
          <div>
            <div className="display text-lg">Alteration Intake</div>
            <div className="caps">
              {billing === "billable" ? "Client billable" : billing === "on_order" ? "On custom · valued · no SI" : REDO_DISPLAY.intakeStrip}
              {" · "}
              draft
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
          <div className="flex gap-1 rounded-full border border-brass/20 bg-black/30 p-1">
            {(["NYC", "HOU"] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setOrigin(loc)}
                className={cn(
                  "px-3 py-2 rounded-full text-[12px] font-bold tracking-widest uppercase",
                  origin === loc ? "bg-brass text-forest-deep" : "text-cream-dim",
                )}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-0.5">
          {steps.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-2 py-3.5 border-b-2 text-xs font-semibold tracking-widest uppercase transition-colors",
                i === step && "border-brass text-cream",
                i < step && "border-brass/35 text-cream-muted",
                i > step && "border-transparent text-cream-dim",
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

      <div className="flex-1 overflow-y-auto px-5 py-6 pb-40">
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
              <div className="card-glass px-4 py-3 flex items-center gap-3 text-sm">
                <span className="caps text-[var(--vi,#9B8BC4)]">Linked order</span>
                <span className="font-mono text-[var(--vi,#9B8BC4)]">{linkedSo}</span>
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
                Continue to garments →
              </button>
            )}
          </div>
        )}

        {/* ── Garments ── */}
        {step === 1 && (
          <div className="max-w-4xl mx-auto">
            {customer && (
              <div className="mb-5">
                <SelectedCustomerCard
                  name={customer.name}
                  phone={customer.phone}
                  email={customer.email}
                  addressLine={customer.addressLine}
                  onEdit={customer.id ? () => setEditOpen(true) : undefined}
                  onChange={() => {
                    setCustomer(null);
                    setStep(0);
                  }}
                />
              </div>
            )}
            <h2 className="display text-[34px] mb-1">
              What did {(displayName || "they").split(" ")[0]} bring in?
            </h2>
            <p className="text-[12.5px] text-cream-dim mb-6">Tap each piece. Tap again for another of the same kind.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
              {GARMENT_TYPES.map((t) => {
                const count = garments.filter((g) => g.garmentType === t).length;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addGarment(t)}
                    className="relative card-glass min-h-[168px] flex flex-col items-center justify-center gap-3 p-4 active:scale-95"
                  >
                    {count > 0 && (
                      <span className="absolute top-2.5 right-2.5 min-w-[26px] h-[26px] rounded-full bg-brass text-forest-deep text-xs font-bold grid place-items-center">
                        {count}
                      </span>
                    )}
                    {garmentIcon(t)}
                    <span className="text-xs font-semibold tracking-widest uppercase text-cream-muted text-center">{t}</span>
                  </button>
                );
              })}
            </div>

            {/* Per-garment condition photos (Lucia 023) */}
            {garments.length > 0 && (
              <div className="mt-6 space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="display text-[22px] italic">Photograph at intake</div>
                    <p className="text-[12px] text-cream-dim mt-1">
                      Take or attach photos before we touch the piece — damage claim proof.
                    </p>
                  </div>
                </div>
                {garments.map((g) => (
                  <div
                    key={g.ref}
                    className="card-glass p-4 flex flex-col sm:flex-row gap-4 sm:items-center"
                  >
                    <div className="min-w-[120px]">
                      <span className="chip mb-1.5">{g.ref}</span>
                      <div className="font-semibold text-[14px]">{g.garmentType}</div>
                      <div className="text-[12px] text-cream-dim mt-1">
                        {(g.photoPreviewUrls || []).length} photo
                        {(g.photoPreviewUrls || []).length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 flex-1 items-center">
                      {(g.photoPreviewUrls || []).map((src, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-brass/30">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeGarmentPhoto(g.ref, i)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-[12px] text-cream grid place-items-center"
                            aria-label="Remove photo"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <label className="h-16 min-w-[7.5rem] px-3 rounded-xl border border-brass/40 bg-brass/15 text-brass-light text-[12px] font-bold tracking-wider uppercase grid place-items-center text-center cursor-pointer hover:bg-brass/25">
                        📷 Take photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files) Array.from(files).forEach((f) => addGarmentPhoto(g.ref, f));
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label className="h-16 min-w-[7.5rem] px-3 rounded-xl border border-dashed border-brass/35 text-cream-dim text-[12px] font-bold tracking-wider uppercase grid place-items-center text-center cursor-pointer hover:border-brass/55 hover:text-brass-light">
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files) Array.from(files).forEach((f) => addGarmentPhoto(g.ref, f));
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {garments.length > 0 && (
              <button type="button" onClick={() => setStep(2)} className="btn-brass mt-6 h-14 px-8 text-[12px]">
                Price the work →
              </button>
            )}
          </div>
        )}

        {/* ── Work (Lucia 030) ── */}
        {step === 2 && (
          <div className={cn("mx-auto", billing === "on_order" ? "max-w-6xl" : "max-w-4xl")}>
            <h2 className="display text-[34px] mb-1">What needs doing?</h2>
            <p className="text-[12.5px] text-cream-dim mb-4">
              {billing === "on_order"
                ? "Pieces from the order cart are on the right — select one, price the work."
                : "Presets · custom lines · notes. Prices stay for internal value even on Re-do / custom order."}
            </p>

            <div className={cn(billing === "on_order" ? "grid lg:grid-cols-[1fr_280px] gap-4 items-start" : "")}>
              <div className="min-w-0">
                {billing !== "on_order" && (
                  <div className="flex gap-2.5 overflow-x-auto pb-4 mb-2">
                    {garments.map((g) => (
                      <button
                        key={g.ref}
                        type="button"
                        onClick={() => setActiveRef(g.ref)}
                        className={cn(
                          "min-w-[174px] card-glass p-3.5 text-left",
                          active?.ref === g.ref && "border-brass bg-brass/15",
                        )}
                      >
                        <span className="chip mb-2">{g.ref}</span>
                        <div className="font-semibold text-[13px]">{g.garmentType}</div>
                        <div className="display text-lg text-brass-light mt-1">
                          {money(g.lines.reduce((s, l) => s + l.price, 0))}
                        </div>
                        {(g.photoPreviewUrls || []).length > 0 && (
                          <div className="text-[12px] text-cream-dim mt-1">
                            📷 {(g.photoPreviewUrls || []).length}
                          </div>
                        )}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="min-w-[96px] rounded-[15px] border border-dashed border-brass/35 grid place-items-center text-2xl text-brass-light"
                    >
                      +
                    </button>
                  </div>
                )}
                {billing !== "on_order" && active && (
                  <div className="mb-4">
                    <GarmentPhotoStrip
                      large
                      garment={active}
                      onAdd={(file) => addGarmentPhoto(active.ref, file)}
                      onRemove={(idx) => removeGarmentPhoto(active.ref, idx)}
                    />
                  </div>
                )}
                {billing === "on_order" && active && (
                  <div className="mb-4 card-glass px-4 py-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="chip bg-[rgba(155,139,196,0.25)] text-[var(--vi,#9B8BC4)] border-[rgba(155,139,196,0.45)]">
                        {active.ref}
                      </span>
                      <span className="font-semibold">{active.garmentType}</span>
                      {active.notes ? (
                        <span className="text-[12px] text-cream-dim truncate flex-1">{active.notes}</span>
                      ) : null}
                      <span className="ml-auto display text-xl text-brass-light shrink-0">
                        {money(active.lines.reduce((s, l) => s + l.price, 0))}
                      </span>
                    </div>
                    <GarmentPhotoStrip
                      large
                      garment={active}
                      onAdd={(file) => addGarmentPhoto(active.ref, file)}
                      onRemove={(idx) => removeGarmentPhoto(active.ref, idx)}
                    />
                  </div>
                )}

            {/* Selected lines first (with note affordance) */}
            {active && active.lines.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                {active.lines.map((l) => {
                  const custom = !l.presetId;
                  const open = noteOpenFor === l.id || !!(l.notes && l.notes.trim()) || !!(l.photoPreviewUrls?.length);
                  return (
                    <div key={l.id} className="min-w-0">
                      <div
                        className={cn(
                          "w-full flex items-center gap-3.5 min-h-[72px] px-4 py-3.5 rounded-2xl border text-left",
                          custom
                            ? "border-signal-amber/45 bg-signal-amber/10"
                            : "border-brass bg-brass/15",
                        )}
                      >
                        <span className="w-[30px] h-[30px] rounded-full border grid place-items-center text-sm font-bold shrink-0 bg-brass text-forest-deep border-brass">
                          ✓
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold text-sm">
                            {l.description}
                            {custom ? (
                              <span className="ml-2 text-[7.5px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-signal-amber/50 text-signal-amber">
                                custom
                              </span>
                            ) : null}
                          </span>
                          <span className="text-[12px] text-cream-dim">
                            {custom ? "Out of scope · priced on the spot" : l.estMinutes ? `${l.estMinutes} min` : "—"}
                          </span>
                        </span>
                        <span className="display text-2xl text-brass-light shrink-0">{money(l.price)}</span>
                        <button
                          type="button"
                          className="w-9 h-9 rounded-lg bg-white/[0.04] text-cream-dim shrink-0"
                          onClick={() => removeLine(active.ref, l.id)}
                          aria-label="Remove line"
                        >
                          ✕
                        </button>
                      </div>
                      {!open ? (
                        <button
                          type="button"
                          onClick={() => setNoteOpenFor(l.id)}
                          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold tracking-widest uppercase text-cream-dim border border-brass/25 bg-black/20 rounded-md px-2.5 py-1.5 hover:border-brass/50 hover:text-brass-light"
                        >
                          ✎ Note / photo
                        </button>
                      ) : (
                        <div className="mt-2 border-l-2 border-brass pl-3 py-2">
                          <span className="caps text-[12px] text-brass block mb-1.5">Note on this line</span>
                          <textarea
                            value={l.notes || ""}
                            onChange={(e) => updateLineNotes(active.ref, l.id, e.target.value)}
                            placeholder="Working buttonholes — open and re-sew…"
                            rows={2}
                            className="w-full rounded-xl bg-black/40 border border-brass/30 px-3 py-2 text-[12px] text-cream resize-none"
                          />
                          <div className="flex flex-wrap gap-2 mt-2 items-center">
                            {(l.photoPreviewUrls || []).map((src, i) => (
                              <img
                                key={i}
                                src={src}
                                alt=""
                                className="w-10 h-10 rounded-lg object-cover border border-brass/30"
                              />
                            ))}
                            <label className="w-10 h-10 rounded-lg border border-dashed border-brass/35 grid place-items-center text-cream-dim text-lg cursor-pointer hover:border-brass">
                              +
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) addLinePhoto(active.ref, l.id, f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {!l.notes?.trim() && !(l.photoPreviewUrls?.length) && (
                              <button
                                type="button"
                                className="text-[12px] text-cream-dim ml-auto"
                                onClick={() => setNoteOpenFor(null)}
                              >
                                Collapse
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Preset picker */}
            <div className="grid sm:grid-cols-2 gap-3">
              {filteredPresets.map((p) => {
                const on = !!active?.lines.find((l) => l.presetId === p.id);
                if (on) return null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePreset(p)}
                    className="w-full flex items-center gap-3.5 min-h-[92px] px-4 py-4 rounded-2xl border text-left border-brass/20 bg-black/20 hover:border-brass/40"
                  >
                    <span className="w-[30px] h-[30px] rounded-full border grid place-items-center text-sm font-bold shrink-0 border-brass/40 text-transparent">
                      ✓
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-sm">{p.preset_name}</span>
                      <span className="text-[12px] text-cream-dim">{p.est_minutes ? `${p.est_minutes} min` : "—"}</span>
                    </span>
                    <span className="display text-2xl text-brass-light shrink-0">{money(Number(p.price) || 0)}</span>
                  </button>
                );
              })}
            </div>
            {!presets.data?.length && !presets.isLoading && (
              <p className="text-cream-dim text-sm mt-3">No presets loaded — check API / ERP.</p>
            )}

            {/* Custom line */}
            <div className="mt-4 rounded-[17px] border border-dashed border-brass/40 bg-brass/[0.05] p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="display text-[19px] italic">Custom alteration line</span>
                <span className="text-[12px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border border-signal-amber/50 text-signal-amber bg-signal-amber/10">
                  out of scope
                </span>
              </div>
              <div className="grid sm:grid-cols-[1fr_150px] gap-2.5">
                <input
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  placeholder="Describe the work — e.g. re-cut lapel roll, hand-pad"
                  className="h-[52px] rounded-[13px] bg-black/40 border border-brass/30 px-4 text-sm text-cream placeholder:text-cream-dim"
                />
                <input
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder="$0.00"
                  inputMode="decimal"
                  className="h-[52px] rounded-[13px] bg-black/40 border border-brass/30 px-4 text-right display text-xl italic text-brass-light placeholder:text-cream-dim"
                />
              </div>
              <div className="flex flex-wrap gap-3 mt-3 items-center">
                <p className="text-[12px] text-cream-dim flex-1 leading-relaxed min-w-[180px]">
                  Normal line with <b className="text-cream-muted">no preset</b>. Full shop price kept for tailor
                  stats — never $0 (use Re-do for free work).
                </p>
                <button
                  type="button"
                  onClick={addCustomLine}
                  disabled={!customDesc.trim() || !(Number(customPrice.replace(/[^0-9.]/g, "")) > 0)}
                  className="btn-brass h-11 px-6 text-[12px] disabled:opacity-40"
                >
                  Add line
                </button>
              </div>
            </div>

            {/* Ticket note */}
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
              <p className="text-[12px] text-cream-dim mt-2 leading-relaxed">
                <b className="text-signal-amber">Internal</b> is staff-only.{" "}
                <b className="text-cream-muted">On the receipt</b> appears on thermal + e-ticket — deliberate tap.
              </p>
            </div>

            <button type="button" onClick={() => setStep(3)} className="btn-brass mt-6 h-14 px-8 text-[12px]">
              Review →
            </button>
              </div>

              {/* Right order cart — on custom-order path only */}
              {billing === "on_order" && (
                <aside className="lg:sticky lg:top-4 rounded-[20px] border border-[rgba(155,139,196,0.4)] bg-gradient-to-b from-[rgba(155,139,196,0.12)] to-black/35 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[rgba(155,139,196,0.25)]">
                    <div className="display text-[18px] italic">Order cart</div>
                    <div className="font-mono text-[12px] text-[var(--vi,#9B8BC4)] mt-0.5">{linkedSo || "—"}</div>
                  </div>
                  <div className="p-3 space-y-2 max-h-[55vh] overflow-y-auto">
                    {garments.map((g) => {
                      const on = active?.ref === g.ref;
                      const amt = g.lines.reduce((s, l) => s + l.price, 0);
                      const photoN = g.photoPreviewUrls?.length || 0;
                      return (
                        <button
                          key={g.ref}
                          type="button"
                          onClick={() => setActiveRef(g.ref)}
                          className={cn(
                            "w-full text-left rounded-xl border px-3 py-3 transition-all",
                            on
                              ? "border-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.2)]"
                              : "border-white/10 bg-black/25 hover:border-[rgba(155,139,196,0.35)]",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {photoN > 0 && g.photoPreviewUrls?.[0] ? (
                              <img
                                src={g.photoPreviewUrls[0]}
                                alt=""
                                className="w-9 h-9 rounded-lg object-cover border border-brass/30 shrink-0"
                              />
                            ) : (
                              <span className="w-9 h-9 rounded-lg border border-dashed border-brass/30 grid place-items-center text-cream-dim text-sm shrink-0">
                                📷
                              </span>
                            )}
                            <span className="chip text-[12px]">{g.ref}</span>
                            <span className="font-semibold text-[13px] flex-1">{g.garmentType}</span>
                            <span className="display text-lg text-brass-light">{money(amt)}</span>
                          </div>
                          {g.notes ? <div className="text-[12px] text-cream-dim mt-1 truncate">{g.notes}</div> : null}
                          {g.soItemName ? (
                            <div className="text-[12px] text-[var(--vi,#9B8BC4)] mt-0.5 truncate">{g.soItemName}</div>
                          ) : null}
                          <div className="text-[12px] text-cream-dim mt-1">
                            {g.lines.length} line{g.lines.length === 1 ? "" : "s"}
                            {photoN ? ` · ${photoN} photo${photoN === 1 ? "" : "s"}` : ""}
                            {on ? " · active" : " · tap to adjust"}
                          </div>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="w-full rounded-xl border border-dashed border-[rgba(155,139,196,0.4)] py-3 text-[12px] text-[var(--vi,#9B8BC4)] font-semibold"
                    >
                      + Add piece
                    </button>
                  </div>
                  <div className="px-4 py-3 border-t border-[rgba(155,139,196,0.25)] flex items-center justify-between">
                    <span className="caps text-[12px] text-cream-dim">Ticket value</span>
                    <span className="display text-xl text-brass-light">{money(total)}</span>
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}

        {/* ── Review ── */}
        {step === 3 && (
          <div className="max-w-2xl mx-auto">
            {customer && (
              <div className="mb-5">
                <SelectedCustomerCard
                  name={customer.name}
                  phone={customer.phone}
                  email={customer.email}
                  addressLine={customer.addressLine}
                  onEdit={customer.id ? () => setEditOpen(true) : undefined}
                />
              </div>
            )}
            <h2 className="display text-[34px] mb-1">
              Read it back to {(displayName || "the client").split(" ")[0]}
            </h2>
            <p className="text-[12.5px] text-cream-dim mb-5">Confirm before write to ERPNext.</p>
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
      </div>

      {/* sticky bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 px-5 py-4 border-t border-brass/25 bg-gradient-to-b from-forest-deep/55 to-forest-deep/97 backdrop-blur-xl flex items-center gap-4">
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="flex items-center gap-3.5 min-w-0 rounded-[14px] border border-brass/25 bg-white/[0.04] pl-2 pr-4 py-2"
        >
          <span className="relative w-[46px] h-[46px] rounded-xl border border-brass/20 bg-black/30 grid place-items-center text-brass-light">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 8h16l-1.2 12H5.2L4 8Z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] rounded-full bg-brass text-forest-deep text-[12px] font-bold grid place-items-center">
              {lineCount}
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
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending || garments.length === 0 || (!customer && !newName.trim())}
          className="btn-brass h-[74px] px-8 text-[13px] disabled:opacity-40 shadow-[0_12px_34px_rgba(176,141,87,0.25)]"
        >
          {create.isPending ? "Writing…" : billing === "billable" ? "Submit ticket →" : "Submit (no charge) →"}
        </button>
      </div>

      {/* cart peek drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg max-h-[70vh] overflow-y-auto rounded-t-[26px] border border-brass/30 p-5"
            style={{ background: "linear-gradient(180deg,#13291C,#0D1A10)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-[52px] h-1 rounded-full bg-brass/40 mx-auto mb-4" />
            <div className="flex items-center mb-4">
              <h3 className="display text-[25px]">
                Ticket — {garments.length} garments, {lineCount} lines
              </h3>
              <button type="button" className="ml-auto w-11 h-11 rounded-xl border border-brass/25" onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>
            {garments.map((g) => (
              <div key={g.ref} className="mb-3">
                <div className="font-semibold text-sm mb-1">
                  {g.ref} · {g.garmentType}
                </div>
                {g.lines.map((l) => (
                  <div key={l.id} className="flex text-sm text-cream-muted py-1">
                    <span className="flex-1">{l.description}</span>
                    <span>{money(l.price)}</span>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-xs text-cream-dim mt-3">No tax — alterations are a service, not goods.</p>
            <div className="display text-3xl text-brass-light mt-4">{money(total)}</div>
            <button type="button" onClick={() => { setCartOpen(false); openPark(); }} className="btn-ghost w-full h-12 mt-4 text-[12px]">
              Park this ticket…
            </button>
          </div>
        </div>
      )}

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

      {editOpen && customer?.id && (
        <CustomerEditSheet
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
