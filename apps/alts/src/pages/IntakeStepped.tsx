import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { localFirstCatalog, localFirstCustomerSearch } from "@alts/offline/localFirst";
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
import { garmentMatchesPreset } from "@alts/components/intake/TaskSubitemPicker";
import SellItemCatalog, {
  type SellFilterId,
  type SellableItem,
} from "@alts/components/intake/SellItemCatalog";
import SellItemDrawer from "@alts/components/intake/SellItemDrawer";
import PromiseSchedule, {
  DEFAULT_PROMISE_TIME,
  snapPromiseTime,
  type DayLoad,
} from "@alts/components/intake/PromiseSchedule";
import DeliveryBlock, {
  emptyDelivery,
  type DeliverySelection,
} from "@alts/components/intake/DeliveryBlock";
import IntakeConfirm, {
  type IntakeConfirmResult,
} from "@alts/components/intake/IntakeConfirm";
import { enqueueIntakeTicket } from "@alts/lib/offlineQueue";
import AddressAutocomplete from "@alts/components/intake/AddressAutocomplete";
import { formatMoney } from "@alts/lib/money";

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
  source?: "erp" | "seed" | "house";
  kind?: "mtm" | "rtw";
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
