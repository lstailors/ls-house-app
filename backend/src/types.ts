// L&S House — Shared Zod schemas (single source of truth for API contracts).
// Imported by both backend routes and frontend pages.

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────

export const UserRole = z.enum(["super_admin", "store_manager", "salesperson", "driver", "tailor"]);
export type UserRole = z.infer<typeof UserRole>;

export const OrderStatus = z.enum([
  "intake",
  "in_progress",
  "ready",
  "picked_up",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const CustomOrderStatus = z.enum([
  "quote",
  "deposit_paid",
  "in_production",
  "ready",
  "delivered",
  "cancelled",
]);
export type CustomOrderStatus = z.infer<typeof CustomOrderStatus>;

export const DeliveryStatus = z.enum([
  "scheduled",
  "out_for_delivery",
  "delivered",
  "failed",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const GarmentType = z.enum([
  "jacket",
  "suit",
  "trousers",
  "vest",
  "overcoat",
  "shirt",
]);
export type GarmentType = z.infer<typeof GarmentType>;

export const StyleCategory = z.enum([
  "lapel",
  "pocket",
  "vent",
  "lining",
  "button",
  "collar",
  "cuff",
  "placket",
]);
export type StyleCategory = z.infer<typeof StyleCategory>;

export const CommChannel = z.enum(["call", "sms"]);
export type CommChannel = z.infer<typeof CommChannel>;

export const InvoiceStatus = z.enum(["draft", "sent", "paid", "void"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

// ─── Domain models ──────────────────────────────────────────────────────

export const Location = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  erpnextCompanyOrBranch: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Location = z.infer<typeof Location>;

export const Profile = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: UserRole,
  locationId: z.string().nullable(),
  location: Location.nullable().optional(),
  image: z.string().nullable(),
  isActive: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

export const Tailor = z.object({
  id: z.string(),
  name: z.string(),
  locationId: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  location: Location.nullable().optional(),
});
export type Tailor = z.infer<typeof Tailor>;

export const CustomerDossier = z.object({
  preferences: z.string().optional(),
  measurements: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  notes: z.string().optional(),
  vip: z.boolean().optional(),
}).passthrough();
export type CustomerDossier = z.infer<typeof CustomerDossier>;

export const Customer = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  locationId: z.string(),
  createdById: z.string(),
  dossier: CustomerDossier,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof Customer>;

export const AlterationItem = z.object({
  label: z.string(),
  price: z.number().optional(),
});
export type AlterationItem = z.infer<typeof AlterationItem>;

export const Alteration = z.object({
  id: z.string(),
  customerId: z.string(),
  customer: Customer.optional(),
  locationId: z.string(),
  items: z.array(AlterationItem),
  price: z.number(),
  status: OrderStatus,
  tailorId: z.string().nullable(),
  tailor: Tailor.optional().nullable(),
  dueDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdById: z.string(),
  createdBy: Profile.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Alteration = z.infer<typeof Alteration>;

export const CustomOrderSpec = z.object({
  fabricId: z.string().optional(),
  lapel: z.string().optional(),
  pockets: z.string().optional(),
  vent: z.string().optional(),
  lining: z.string().optional(),
  buttons: z.string().optional(),
  collar: z.string().optional(),
  cuff: z.string().optional(),
  placket: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();
export type CustomOrderSpec = z.infer<typeof CustomOrderSpec>;

export const CustomOrder = z.object({
  id: z.string(),
  customerId: z.string(),
  customer: Customer.optional(),
  locationId: z.string(),
  garmentType: GarmentType,
  quotedPrice: z.number(),
  priceTbd: z.boolean(),
  depositAmount: z.number(),
  status: CustomOrderStatus,
  notes: z.string().nullable(),
  spec: CustomOrderSpec,
  createdById: z.string(),
  createdBy: Profile.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomOrder = z.infer<typeof CustomOrder>;

export const SalesOrder = z.object({
  id: z.string(),
  customOrderId: z.string().nullable(),
  locationId: z.string(),
  erpnextId: z.string().nullable(),
  status: z.string(),
  total: z.number(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  customer: Customer.optional().nullable(),
});
export type SalesOrder = z.infer<typeof SalesOrder>;

export const Invoice = z.object({
  id: z.string(),
  salesOrderId: z.string().nullable(),
  locationId: z.string(),
  erpnextId: z.string().nullable(),
  status: InvoiceStatus,
  total: z.number(),
  pdfUrl: z.string().nullable(),
  createdAt: z.string(),
  customer: Customer.optional().nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

export const Delivery = z.object({
  id: z.string(),
  orderRef: z.string().nullable(),
  customOrderId: z.string().nullable(),
  customerId: z.string(),
  customer: Customer.optional(),
  locationId: z.string(),
  driverId: z.string().nullable(),
  driver: Profile.optional().nullable(),
  status: DeliveryStatus,
  proofOfDeliveryUrl: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  addressLine: z.string().nullable(),
  notes: z.string().nullable(),
  erpnextSynced: z.boolean(),
  createdAt: z.string(),
  deliveryNo: z.string().nullable().optional(),
  qrToken: z.string().nullable().optional(),
});
export type Delivery = z.infer<typeof Delivery>;

export const FabricPricing = z.object({
  id: z.string(),
  fabricName: z.string(),
  mill: z.string().nullable(),
  composition: z.string().nullable(),
  weight: z.string().nullable(),
  season: z.string().nullable(),
  tier: z.string().nullable(),
  price: z.number(),
  isActive: z.boolean(),
});
export type FabricPricing = z.infer<typeof FabricPricing>;

export const StyleOption = z.object({
  id: z.string(),
  category: StyleCategory,
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
});
export type StyleOption = z.infer<typeof StyleOption>;

export const Communication = z.object({
  id: z.string(),
  customerId: z.string(),
  customer: Customer.optional(),
  locationId: z.string(),
  channel: CommChannel,
  direction: z.enum(["inbound", "outbound"]),
  transcript: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: z.string(),
});
export type Communication = z.infer<typeof Communication>;

// ─── Request inputs ─────────────────────────────────────────────────────

export const CreateAlterationInput = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal("")),
  garmentDescription: z.string().optional().default(""),
  items: z.array(AlterationItem).min(1),
  price: z.number().min(0),
  tailorId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  locationId: z.string().optional(),
});

export const CreateCustomOrderInput = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal("")),
  garmentType: GarmentType,
  quotedPrice: z.number().min(0),
  priceTbd: z.boolean().default(false),
  depositAmount: z.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  spec: CustomOrderSpec.optional().default({}),
  locationId: z.string().optional(),
});

export const UpdateOrderStatusInput = z.object({
  status: z.string(),
  tailorId: z.string().nullable().optional(),
});

export const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: UserRole,
  locationId: z.string().nullable().optional(),
});

export const UpdateUserInput = z.object({
  name: z.string().optional(),
  role: UserRole.optional(),
  locationId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const CreateLocationInput = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  erpnextCompanyOrBranch: z.string().optional().nullable(),
});

export const CreateTailorInput = z.object({
  name: z.string().min(1),
  locationId: z.string().min(1),
});

export const CreateFabricInput = FabricPricing.omit({ id: true });

export const CreateStyleOptionInput = StyleOption.omit({ id: true });

export const TakeDepositInput = z.object({
  customOrderId: z.string(),
  amount: z.number().min(0),
});

// ─── Aggregate KPI shapes (dashboard) ───────────────────────────────────

export const DashboardKpis = z.object({
  revenue: z.number(),
  ordersByStage: z.record(z.string(), z.number()),
  deliveriesDue: z.number(),
  openAlterations: z.number(),
  customInProduction: z.number(),
  depositsPending: z.number(),
  todayIntakeCount: z.number(),
  myCustomOrdersByStage: z.record(z.string(), z.number()).optional(),
  myDeliveriesToday: z.number().optional(),
  myDeliveriesCompletedToday: z.number().optional(),
  lowActivityLocations: z.array(z.object({
    locationId: z.string(),
    locationName: z.string(),
    orders7d: z.number(),
  })).optional(),
  fabricDelayAlerts: z.number().optional(),
  altReady: z.number().optional(),
  altOverdue: z.number().optional(),
  altRush: z.number().optional(),
  altByStatus: z.object({ received: z.number(), inProgress: z.number(), ready: z.number() }).optional(),
  altRevenueMTD: z.number().optional(),
  revenueMTD: z.number().optional(),
  garmentsByStage: z.record(z.string(), z.number()).optional(),
  garmentsProd: z.number().optional(),
  unansweredSms: z.number().optional(),
  depositsPendingAmount: z.number().optional(),
});
export type DashboardKpis = z.infer<typeof DashboardKpis>;

// ─── Maestro / Approval queue ────────────────────────────────────────────

export const ApprovalStatus = z.enum([
  "pending", "awaiting_second", "approved", "denied",
  "revised", "expired", "cancelled", "shadow_review",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalCategory = z.enum([
  "email", "social", "task", "factory", "financial",
  "marketing", "order", "communication", "system",
  "other", "outbound_sms", "outbound_email",
]);
export type ApprovalCategory = z.infer<typeof ApprovalCategory>;

export const ApprovalQueueItem = z.object({
  id: z.string(),
  status: ApprovalStatus,
  category: ApprovalCategory,
  source_agent: z.string(),
  title: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  proposed_action: z.string().nullable().optional(),
  on_approve_action: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItem>;

export const MaestroBriefPayload = z.object({
  date: z.string().optional(),
  brief: z.string().optional(),
  signals: z.array(z.object({
    key: z.string(),
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    category: ApprovalCategory.optional(),
    accent: z.enum(["default","emerald","amber","rose"]).optional(),
    delta: z.string().optional(),
  })).optional(),
  anomalies: z.array(z.object({
    id: z.string(),
    message: z.string(),
    severity: z.enum(["info","warn","critical"]).optional(),
  })).optional(),
}).passthrough();
export type MaestroBriefPayload = z.infer<typeof MaestroBriefPayload>;

// ─── Sofia ────────────────────────────────────────────────────────────────

export const SofiaMessage = z.object({
  id: z.string(),
  client_phone: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string().nullable(),
  status: z.string().nullable().optional(),
  agent_name: z.string().nullable().optional(),
  created_at: z.string(),
});
export type SofiaMessage = z.infer<typeof SofiaMessage>;

export const VoiceApproval = z.object({
  id: z.string(),
  client_phone: z.string().nullable().optional(),
  client_name: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();
export type VoiceApproval = z.infer<typeof VoiceApproval>;

// ─── Mission Control — Agents ─────────────────────────────────────────────────

export const AgentStatus = z.enum(["active", "idle", "paused", "error", "offline"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentTaskPriority = z.enum(["low", "medium", "high", "urgent"]);
export type AgentTaskPriority = z.infer<typeof AgentTaskPriority>;

export const AgentTaskStatus = z.enum(["pending", "in_progress", "completed", "blocked", "cancelled"]);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatus>;

export const AgentEventSeverity = z.enum(["info", "warning", "error", "critical"]);
export type AgentEventSeverity = z.infer<typeof AgentEventSeverity>;

export const Agent = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: AgentStatus.nullable().optional(),
  model: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  current_task: z.string().nullable().optional(),
  current_task_since: z.string().nullable().optional(),
  last_action_at: z.string().nullable().optional(),
  last_action_summary: z.string().nullable().optional(),
  last_heartbeat_at: z.string().nullable().optional(),
  health_score: z.number().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  stats: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentTask = z.object({
  id: z.string(),
  assigned_to: z.string(),
  assigned_by: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: AgentTaskPriority.nullable().optional(),
  status: AgentTaskStatus,
  due_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  result_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  linked_approval_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const AgentEvent = z.object({
  id: z.string(),
  agent_slug: z.string(),
  event_type: z.string(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  severity: AgentEventSeverity.nullable().optional(),
  task_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string(),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

export const DelegateTaskBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: AgentTaskPriority.optional(),
  due_at: z.string().optional(),
});
export type DelegateTaskBody = z.infer<typeof DelegateTaskBody>;
