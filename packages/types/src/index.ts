// L&S House — Shared Zod schemas (single source of truth for API contracts).
// Imported by both backend routes and frontend pages.

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────

export const UserRole = z.enum(["super_admin", "store_manager", "salesperson", "driver", "tailor", "customer"]);
export type UserRole = z.infer<typeof UserRole>;

export const OrderStatus = z.enum([
  "intake",
  "in_progress",
  "ready",
  "picked_up",
  "complete",
  "delivered",
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
  "cancelled",
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

export const InvoiceStatus = z.enum(["draft", "sent", "paid", "void", "unpaid", "overdue"]);
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
  opsMode: z.enum(["live", "test"]).optional(),
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
  address: z.string().nullable().optional(),
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

export const AlterationTicketGarment = z.object({
  name: z.string(),
  garment_id: z.string().nullable().optional(),
  garment_type: z.string().nullable().optional(),
  garment_description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
}).passthrough();
export type AlterationTicketGarment = z.infer<typeof AlterationTicketGarment>;

export const AlterationTicketLine = z.object({
  name: z.string().optional(),
  garment_ref: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.number().optional().default(0),
  preset: z.string().nullable().optional(),
}).passthrough();
export type AlterationTicketLine = z.infer<typeof AlterationTicketLine>;

export const AlterationTicketDoc = z.object({
  name: z.string(),
  customer: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_mobile: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  origin_location: z.string().nullable().optional(),
  workflow_state: z.string().nullable().optional(),
  ticket_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  is_rush: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  ticket_total: z.number().optional().default(0),
  payment_status: z.string().nullable().optional(),
  assigned_tailor: z.string().nullable().optional(),
  assigned_tailor_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  customer_notes: z.string().nullable().optional(),
  delivery_method: z.string().nullable().optional(),
  notified_ready_at: z.string().nullable().optional(),
  garments: z.array(AlterationTicketGarment).optional().default([]),
  lines: z.array(AlterationTicketLine).optional().default([]),
}).passthrough();
export type AlterationTicketDoc = z.infer<typeof AlterationTicketDoc>;

export const PrintConfig = z.object({
  enabled: z.boolean(),
  printer_ip: z.string(),
  printer_port: z.number(),
  timeout: z.number(),
  app_base_url: z.string(),
});
export type PrintConfig = z.infer<typeof PrintConfig>;

export const PaymentLinkResponse = z.object({
  ok: z.literal(true),
  url: z.string(),
  payment_link_id: z.string(),
});
export type PaymentLinkResponse = z.infer<typeof PaymentLinkResponse>;

export const TerminalCheckoutResponse = z.object({
  ok: z.literal(true),
  checkout_id: z.string(),
});
export type TerminalCheckoutResponse = z.infer<typeof TerminalCheckoutResponse>;

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
  garments: z.array(z.record(z.string(), z.unknown())).optional(),
  erpName: z.string().nullable().optional(),
  erpnextName: z.string().nullable().optional(),
  orderStatus: z.string().nullable().optional(),
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
  salesOrderId: z.string().nullable().optional(),
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
  deliveriesOutForDelivery: z.number().optional(),
  deliveriesDeliveredToday: z.number().optional(),
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

// ─── YongZheng (YZ) Helpdesk tickets ──────────────────────────────────────
// Open ERPNext HD Ticket rows assigned to the YongZheng agent group.

export const YZTicket = z.object({
  name: z.string(),                              // ERPNext ticket id
  subject: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  orderId: z.string().nullable(),               // lsh_mtm_pro_order || lsh_yz_order_no || null
  proOrder: z.string().nullable(),              // lsh_mtm_pro_order
  yzOrderNo: z.string().nullable(),             // lsh_yz_order_no
  creation: z.string(),                         // ISO datetime
  assignees: z.array(z.string()),               // parsed from _assign
  daysOpen: z.number(),                         // whole days since creation
  escalate: z.boolean(),                        // open >= 3 days AND status !== 'Resolved'
  url: z.string(),                              // ERPNext deep link
});
export type YZTicket = z.infer<typeof YZTicket>;

// ─── YZ Production Tracker (Shop Floor) ────────────────────────────────────
// Live production orders from the ERPNext "YZ Production Tracker" doctype.
// Powers the /shop-floor page. Booleans normalized from ERPNext 0/1 checks,
// empty production_status defaulted to "In Production", ERPNext deep link added.

export const YZProductionStatus = z.enum([
  "In Production",
  "Shipped",
  "Rush",
  "Canceled",
  "On Pause",
  "Fabric Not Received",
]);
export type YZProductionStatus = z.infer<typeof YZProductionStatus>;

// Computed "needs attention" flags, attached server-side to each order.
export const YZAttentionFlag = z.object({
  code: z.enum(["overdue", "stale_fabric", "rush_at_risk", "no_ship_date"]),
  label: z.string(),
  severity: z.enum(["high", "medium"]),
});
export type YZAttentionFlag = z.infer<typeof YZAttentionFlag>;

export const YZOrder = z.object({
  name: z.string(),                              // primary key (== order_no)
  order_no: z.string(),
  production_status: YZProductionStatus,         // empty rows normalized to "In Production"
  customer_name: z.string().nullable(),
  customer: z.string().nullable(),              // linked Customer id
  mtmpro_order: z.string().nullable(),
  fabric_number: z.string().nullable(),
  process_category: z.string().nullable(),      // Machine | Half-Hand | Full-Hand
  garment_summary: z.string().nullable(),
  total_pieces: z.number(),
  qty_suit_coat: z.number(),
  qty_suit_pant: z.number(),
  qty_suit_vest: z.number(),
  qty_overcoat: z.number(),
  qty_shirt: z.number(),
  qty_tux_coat: z.number(),
  qty_tux_pant: z.number(),
  qty_tux_vest: z.number(),
  date_received: z.string().nullable(),         // YYYY-MM-DD
  date_placed: z.string().nullable(),
  ship_date_planned: z.string().nullable(),
  rush_days: z.number(),
  embroidery_name: z.string().nullable(),
  embroidery_qty: z.number(),
  tracking_no: z.string().nullable(),
  customs_flag: z.string().nullable(),
  delivery_manner: z.string().nullable(),
  /** Shipment status from LSH Logistics Tracker (Factory Inbound lane). Null = no tracker row. */
  shipment_status: z.string().nullable().optional(),
  /** Current ETA from LSH Logistics Tracker (YYYY-MM-DD). Null = not set. */
  shipment_eta: z.string().nullable().optional(),
  solid_fabric: z.boolean(),
  fully_lined: z.boolean(),
  half_canvas: z.boolean(),
  basted_note: z.string().nullable(),
  comment: z.string().nullable(),
  remarks: z.string().nullable(),
  erpUrl: z.string(),                            // ERPNext deep link
  attention: z.array(YZAttentionFlag),           // computed risk flags (may be empty)
});
export type YZOrder = z.infer<typeof YZOrder>;

// AI-assisted production brief for the Shop Floor banner.
export const YZBriefItem = z.object({
  order_no: z.string(),
  customer_name: z.string().nullable(),
  reason: z.string(),
  severity: z.enum(["high", "medium"]),
});
export type YZBriefItem = z.infer<typeof YZBriefItem>;

export const YZProductionBrief = z.object({
  generatedAt: z.string(),                       // ISO timestamp
  headline: z.string(),                          // 1-2 sentence AI summary (may be "")
  stats: z.object({
    active: z.number(),
    rush: z.number(),
    shippingThisWeek: z.number(),
    overdue: z.number(),
    attention: z.number(),
  }),
  items: z.array(YZBriefItem),                    // prioritized attention list
});
export type YZProductionBrief = z.infer<typeof YZProductionBrief>;

// ─── Helpdesk (HD Ticket) ──────────────────────────────────────────────────

export const HDCommunication = z.object({
  name: z.string(),
  sender: z.string().nullable(),
  senderName: z.string().nullable(),
  content: z.string().nullable(),
  sentOrReceived: z.string().nullable(),  // "Sent" | "Received"
  creation: z.string(),
  communicationType: z.string().nullable(),
});
export type HDCommunication = z.infer<typeof HDCommunication>;

export const HDTicket = z.object({
  name: z.string(),
  subject: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  ticketType: z.string().nullable(),
  agentGroup: z.string().nullable(),
  proOrder: z.string().nullable(),
  yzOrderNo: z.string().nullable(),
  orderId: z.string().nullable(),
  creation: z.string(),
  modified: z.string(),
  assignees: z.array(z.string()),
  daysOpen: z.number(),
  escalate: z.boolean(),
  url: z.string(),
});
export type HDTicket = z.infer<typeof HDTicket>;

export const HDTicketDetail = HDTicket.extend({
  description: z.string().nullable(),
  communications: z.array(HDCommunication),
});
export type HDTicketDetail = z.infer<typeof HDTicketDetail>;

export const NewHDTicketBody = z.object({
  subject: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  agentGroup: z.string().optional(),
});
export type NewHDTicketBody = z.infer<typeof NewHDTicketBody>;

export const UpdateHDTicketStatusBody = z.object({
  status: z.string().min(1),
});

export const HDTicketReplyBody = z.object({
  message: z.string().min(1),
});

// ─── Staff Appointments Dashboard ─────────────────────────────────────────────

export const LSHAgent = z.object({
  name: z.string(),
  agentUser: z.string(),
  displayName: z.string(),
  tagAliases: z.string(),
  active: z.boolean(),
});
export type LSHAgent = z.infer<typeof LSHAgent>;

export const LSHAppointmentType = z.object({
  name: z.string(),
  appointmentType: z.string(),
  category: z.string(),
  needsRoom: z.boolean(),
  publiclyBookable: z.boolean(),
});
export type LSHAppointmentType = z.infer<typeof LSHAppointmentType>;

export const StaffAppointment = z.object({
  name: z.string(),
  scheduledTime: z.string(),
  endTime: z.string().nullable(),
  status: z.enum(["Open", "Unverified", "Closed"]),
  assignedAgent: z.string().nullable(),
  agentDisplayName: z.string().nullable(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string().nullable(),
  customerDetails: z.string().nullable(),
  appointmentType: z.string().nullable(),
  needsRoom: z.boolean(),
  calendarEventId: z.string().nullable(),
  isBlock: z.literal(false),
});
export type StaffAppointment = z.infer<typeof StaffAppointment>;

export const TimeBlock = z.object({
  name: z.string(),
  subject: z.string(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  allDay: z.boolean(),
  agentUser: z.string().nullable(),
  agentDisplayName: z.string().nullable(),
  reason: z.string().nullable(),
  isWholeshop: z.boolean(),
  isBlock: z.literal(true),
});
export type TimeBlock = z.infer<typeof TimeBlock>;

export const AppointmentsListResponse = z.object({
  appointments: z.array(StaffAppointment),
  blocks: z.array(TimeBlock),
});
export type AppointmentsListResponse = z.infer<typeof AppointmentsListResponse>;

export const BlockTimeRequest = z.object({
  start: z.string(),
  end: z.string().optional(),
  reason: z.string().optional(),
  all_day: z.boolean().optional().default(false),
  whole_shop: z.boolean().optional().default(false),
});
export type BlockTimeRequest = z.infer<typeof BlockTimeRequest>;

export const StaffBookingRequest = z.object({
  agent_user: z.string(),
  appointment_type: z.string(),
  scheduled_time: z.string(),
  end_time: z.string().optional(),
  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  customer_phone: z.string().optional(),
  notes: z.string().optional(),
});
export type StaffBookingRequest = z.infer<typeof StaffBookingRequest>;

export const SetAppointmentStatusRequest = z.object({
  status: z.enum(["confirm", "complete", "no_show", "cancel"]),
});
export type SetAppointmentStatusRequest = z.infer<typeof SetAppointmentStatusRequest>;

// ─── Public booking (book.lstailors.com → ERPNext → Google) ───────────────────

export const PublicBookingType = z.object({
  id: z.enum(["consultation", "fitting", "alterations"]),
  erpType: z.string(),
  label: z.string(),
  description: z.string(),
  durationMinutes: z.number().int().positive(),
  needsRoom: z.boolean(),
  requiresEligibilityGate: z.boolean(),
});
export type PublicBookingType = z.infer<typeof PublicBookingType>;

export const PublicBookingTailor = z.object({
  id: z.string(),
  agentUser: z.string(),
  displayName: z.string(),
  shortName: z.string(),
});
export type PublicBookingTailor = z.infer<typeof PublicBookingTailor>;

export const PublicBookingSlot = z.object({
  datetime: z.string(),
  date: z.string(),
  time: z.string(),
  end_datetime: z.string().optional(),
  duration_minutes: z.number().optional(),
  rooms_free: z.number().optional(),
  free_agents: z.array(
    z.object({
      agent_user: z.string(),
      display_name: z.string(),
      tailor_id: z.string().optional(),
    }),
  ),
});
export type PublicBookingSlot = z.infer<typeof PublicBookingSlot>;

export const PublicBookingSlotsResponse = z.object({
  appointmentType: z.object({
    id: z.string(),
    erpType: z.string(),
    label: z.string(),
    durationMinutes: z.number(),
    needsRoom: z.boolean(),
    requiresEligibilityGate: z.boolean(),
  }),
  fittingRoomCount: z.number(),
  slots: z.array(PublicBookingSlot),
  meta: z.object({
    dateFrom: z.string(),
    dateTo: z.string(),
    tailorFilter: z.string().nullable(),
    holidaySource: z.enum(["erp", "fallback"]),
    generatedAt: z.string(),
  }),
});
export type PublicBookingSlotsResponse = z.infer<typeof PublicBookingSlotsResponse>;

// ─── Scanner (in-app QR scanner → ERPNext ls_alterations.api.scanner) ─────
// Mirrors the resolve_qr return contract. meta is intentionally permissive
// (passthrough) so new ERPNext fields don't break parsing.

export const ScannerType = z.enum([
  "sales_invoice",
  "alteration_ticket",
  "lsh_delivery",
  "custom_order",
  "tailor_transfer",
  "payment_link",
  "garment_tag",
  "customer",
]);
export type ScannerType = z.infer<typeof ScannerType>;
export const ScannerResolveRequest = z.object({
  token: z.string().min(1),
});
export type ScannerResolveRequest = z.infer<typeof ScannerResolveRequest>;

export const ScannerResult = z
  .object({
    ok: z.boolean(),
    type: ScannerType.optional(),
    doctype: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    state: z.string().optional(),
    actions: z.array(z.string()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().optional(),
    raw: z.string().optional(),
  })
  .passthrough();
export type ScannerResult = z.infer<typeof ScannerResult>;

export const ScannerActionResult = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  idempotent: z.boolean().optional(),
});
export type ScannerActionResult = z.infer<typeof ScannerActionResult>;

// ─── MTM Quality Control (store-side, after Received at Store) ───────────

export const QcCheckResult = z.object({
  id: z.string(),
  group: z.string(),
  label: z.string(),
  hint: z.string().optional(),
  pass: z.boolean().nullable(),
});
export type QcCheckResult = z.infer<typeof QcCheckResult>;

export const QcInspection = z.object({
  id: z.string().nullable(),
  name: z.string().nullable().optional(),
  salesOrder: z.string().nullable().optional(),
  mtmproOrder: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  inspector: z.string().nullable().optional(),
  inspectorEmail: z.string().nullable().optional(),
  result: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  failReason: z.string().optional(),
  nextStatus: z.string().nullable().optional(),
  checks: z.array(QcCheckResult).optional(),
  summary: z
    .object({
      total: z.number(),
      passed: z.number(),
      failed: z.number(),
      open: z.number(),
    })
    .optional(),
  signedAt: z.string().nullable().optional(),
  signatureUrl: z.string().nullable().optional(),
  docusealEmbedSrc: z.string().nullable().optional(),
  scanUrl: z.string().optional(),
  photos: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        url: z.string(),
        createdAt: z.string().optional(),
      }),
    )
    .optional(),
  docuseal: z.boolean().optional(),
  orderStatus: z.string().nullable().optional(),
  garmentSummary: z.string().nullable().optional(),
});
export type QcInspection = z.infer<typeof QcInspection>;

// ─── Garment Job Card (scan → /g/:ticket/:garmentId) ─────────────────────
// Backed by Frappe Server Scripts (API type), called by bare name:
//   /api/method/get_garment_job_card | update_garment_status | complete_garment
// Schemas are permissive (.passthrough(), loose fields) — the proxy passes the
// ERP payload through unchanged; these exist for frontend typing.

export const GarmentJobLine = z
  .object({
    description: z.string().optional().nullable(),
    preset: z.string().optional().nullable(),
    amount: z.number().optional().nullable(),
    tailor: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    est_minutes: z.number().optional().nullable(),
    actual_minutes: z.number().optional().nullable(),
  })
  .passthrough();
export type GarmentJobLine = z.infer<typeof GarmentJobLine>;

export const GarmentMeasurement = z
  .object({
    type: z.string().optional().nullable(),
    value: z.union([z.number(), z.string()]).optional().nullable(),
    unit: z.string().optional().nullable(),
  })
  .passthrough();
export type GarmentMeasurement = z.infer<typeof GarmentMeasurement>;

export const GarmentDetail = z
  .object({
    id: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    fabric: z.string().optional().nullable(),
    condition: z.string().optional().nullable(),
    fit_area: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    completed_by: z.string().optional().nullable(),
    completed_at: z.string().optional().nullable(),
  })
  .passthrough();
export type GarmentDetail = z.infer<typeof GarmentDetail>;

export const GarmentJobCard = z
  .object({
    ticket: z.string().optional().nullable(),
    ticket_state: z.string().optional().nullable(),
    due_date: z.string().optional().nullable(),
    is_rush: z.union([z.boolean(), z.number()]).optional().nullable(),
    customer: z.string().optional().nullable(),
    customer_phone: z.string().optional().nullable(),
    garment: GarmentDetail.optional().nullable(),
    lines: z.array(GarmentJobLine).optional().default([]),
    measurements: z.array(GarmentMeasurement).optional().default([]),
  })
  .passthrough();
export type GarmentJobCard = z.infer<typeof GarmentJobCard>;

export const GarmentWorker = z.object({
  id: z.string(),
  name: z.string(),
});
export type GarmentWorker = z.infer<typeof GarmentWorker>;

// Request bodies
export const GarmentJobCardRequest = z.object({
  ticket: z.string().min(1),
  garment_id: z.string().min(1),
});
export type GarmentJobCardRequest = z.infer<typeof GarmentJobCardRequest>;

export const GarmentStatusRequest = z.object({
  ticket: z.string().min(1),
  garment_id: z.string().min(1),
  status: z.enum(["In Progress", "Pending"]),
  worker: z.string().optional(),
});
export type GarmentStatusRequest = z.infer<typeof GarmentStatusRequest>;

export const GarmentCompleteRequest = z.object({
  ticket: z.string().min(1),
  garment_id: z.string().min(1),
  worker: z.string().min(1),
  /** Required for floor time tracking (chips). */
  actual_minutes: z.number().positive().max(480),
});
export type GarmentCompleteRequest = z.infer<typeof GarmentCompleteRequest>;

export const GarmentActionResult = z
  .object({
    all_garments_ready: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type GarmentActionResult = z.infer<typeof GarmentActionResult>;

// ─── Complete Garment ───────────────────────────────────────────────────
// Thin proxy to the ERPNext `complete_garment` method (the single source of
// truth for completion logic: it starts work if needed, marks the garment
// Ready, and fires the customer pickup SMS once every garment is Ready).

export const CompleteGarmentRequest = z.object({
  ticket: z.string().min(1),
  garment_id: z.string().min(1),
  worker: z.string().min(1),
  actual_minutes: z.number().positive().max(480),
});
export type CompleteGarmentRequest = z.infer<typeof CompleteGarmentRequest>;

export const CompleteGarmentResult = z
  .object({
    ok: z.boolean(),
    ticket: z.string(),
    garment_id: z.string(),
    garment_status: z.string(),
    ticket_state: z.string(),
    all_garments_ready: z.boolean(),
    movement: z.unknown().optional(),
    notified_ready_at: z.string().nullable().optional(),
  })
  .passthrough();
export type CompleteGarmentResult = z.infer<typeof CompleteGarmentResult>;

// ─── Sofia Dispatch ─────────────────────────────────────────────────────
// Contracts for the Sofia Dispatch SMS console (webapp ↔ backend ↔ n8n
// WF-DISPATCH-10/11).

export const DispatchTemplate = z.object({
  name: z.string(),
  template_name: z.string(),
  category: z.string(),
  body: z.string(),
  resolved_body: z.string(),
  pending_fields: z.array(z.string()),
});
export type DispatchTemplate = z.infer<typeof DispatchTemplate>;

export const DispatchCustomer = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
});
export type DispatchCustomer = z.infer<typeof DispatchCustomer>;

export const DispatchRecentThread = z.object({
  phone: z.string(),
  customerId: z.string().nullable(),
  name: z.string(),
  lastMessage: z.string(),
  lastDirection: z.string().nullable(),
  lastTimestamp: z.string().nullable(),
});
export type DispatchRecentThread = z.infer<typeof DispatchRecentThread>;

export const DispatchMessage = z
  .object({
    name: z.string(),
    client_phone: z.string().nullable().optional(),
    client_name: z.string().nullable().optional(),
    customer: z.string().nullable().optional(),
    direction: z.enum(["inbound", "outbound"]).nullable().optional(),
    content: z.string().nullable().optional(),
    sender: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
    twilio_sid: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    context_tag: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
  })
  .passthrough();
export type DispatchMessage = z.infer<typeof DispatchMessage>;

export const DispatchThread = z.object({
  messages: z.array(DispatchMessage),
  hasMore: z.boolean(),
  phone: z.string().nullable(),
  customer: DispatchCustomer.nullable(),
  optedOut: z.boolean(),
});
export type DispatchThread = z.infer<typeof DispatchThread>;

export const DispatchSendRequest = z.object({
  customer: z.string().optional(),
  clientName: z.string().optional(),
  phone: z.string().min(7),
  body: z.string().min(1).max(1600),
  mode: z.enum(["template", "custom", "sofia"]),
  template: z.string().optional(),
  batch: z.boolean().optional(),
});
export type DispatchSendRequest = z.infer<typeof DispatchSendRequest>;

export const DispatchSendResult = z.object({
  ok: z.boolean(),
  messageId: z.string().nullable(),
  twilioSid: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
});
export type DispatchSendResult = z.infer<typeof DispatchSendResult>;

export const DispatchComposeRequest = z.object({
  customer: z.string().optional(),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  instruction: z.string().min(3).max(2000),
});
export type DispatchComposeRequest = z.infer<typeof DispatchComposeRequest>;

export const DispatchComposeResult = z.object({ draft: z.string() });
export type DispatchComposeResult = z.infer<typeof DispatchComposeResult>;

export const DispatchPhoneRequest = z.object({
  customer: z.string().min(1),
  phone: z.string().min(7),
});
export type DispatchPhoneRequest = z.infer<typeof DispatchPhoneRequest>;

// ─── Mission Control (Board / Crons / History) ───────────────────────────────

export const KanbanTask = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  assignee: z.string().nullable(),
  status: z.enum([
    "triage",
    "todo",
    "scheduled",
    "ready",
    "running",
    "blocked",
    "done",
    "archived",
  ]),
  priority: z.number().optional(),
  age_days: z.number().optional(),
  consecutive_failures: z.number().optional(),
  last_failure_error: z.string().nullable().optional(),
  block_kind: z.string().nullable().optional(),
  result_summary: z.string().nullable().optional(),
  parent_ids: z.array(z.string()).optional(),
  child_ids: z.array(z.string()).optional(),
  comment_count: z.number().optional(),
  created_at: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  snapshot_at: z.string().nullable().optional(),
});
export type KanbanTask = z.infer<typeof KanbanTask>;

export const CronHealth = z.object({
  id: z.string(),
  profile: z.string().optional(),
  agent_slug: z.string(),
  job_id: z.string().optional(),
  job_name: z.string(),
  enabled: z.boolean(),
  status: z.enum(["green", "amber", "red"]),
  health_reasons: z.array(z.string()).optional(),
  last_status: z.string().nullable().optional(),
  last_run_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  last_error: z.string().nullable(),
  last_delivery_error: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  model_snapshot: z.string().nullable(),
  model_drift: z.boolean().optional(),
  stale: z.boolean().optional(),
  schedule_display: z.string().nullable().optional(),
  snapshot_at: z.string().nullable().optional(),
});
export type CronHealth = z.infer<typeof CronHealth>;

export const HistoryEntry = z.object({
  id: z.string(),
  ts: z.string(),
  agent_slug: z.string().nullable(),
  kind: z.enum(["brief", "event", "kanban_comment", "kanban_done", "telemetry", "approval"]),
  title: z.string(),
  snippet: z.string().nullable(),
  doc_ref: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const MissionControlBoardResponse = z.object({
  tasks: z.array(KanbanTask),
  total: z.number(),
  filters: z.object({
    assignee: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    blockedOnly: z.boolean().optional(),
  }),
  warning: z.string().optional(),
});
export type MissionControlBoardResponse = z.infer<typeof MissionControlBoardResponse>;

export const MissionControlCronsResponse = z.object({
  crons: z.array(CronHealth),
  summary: z.object({
    green: z.number(),
    amber: z.number(),
    red: z.number(),
    total: z.number(),
  }),
  warning: z.string().optional(),
});
export type MissionControlCronsResponse = z.infer<typeof MissionControlCronsResponse>;

export const MissionControlHistoryResponse = z.object({
  entries: z.array(HistoryEntry),
  hasMore: z.boolean(),
  query: z.object({
    agent: z.string().nullable().optional(),
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
    q: z.string().nullable().optional(),
    limit: z.number(),
  }),
});

export type MissionControlHistoryResponse = z.infer<typeof MissionControlHistoryResponse>;

// SPEC 071 — Mission Control Alerts (derived read; no new SoT)
export const McAlertType = z.enum([
  "cron_error",
  "stale_approval",
  "agent_dark",
  "cost_anomaly",
]);
export type McAlertType = z.infer<typeof McAlertType>;

export const McAlertSeverity = z.enum(["critical", "warning"]);
export type McAlertSeverity = z.infer<typeof McAlertSeverity>;

export const MissionControlAlert = z.object({
  id: z.string(), // {type}:{source_id}
  type: McAlertType,
  severity: McAlertSeverity,
  title: z.string(),
  context: z.string(),
  source_tab: z.enum(["crons", "approvals", "fleet", "costs"]),
  source_id: z.string(),
  href: z.string(),
  first_seen: z.string().nullable(),
  last_seen: z.string().nullable(),
  occurrences: z.number(),
  age_hours: z.number().nullable(),
});
export type MissionControlAlert = z.infer<typeof MissionControlAlert>;

export const MissionControlAlertsResponse = z.object({
  alerts: z.array(MissionControlAlert),
  count: z.number(),
  critical_count: z.number(),
  warning_count: z.number(),
  highest_severity: McAlertSeverity.nullable(),
  generated_at: z.string(),
  stale_approval_threshold_hours: z.number(),
  gated: z.object({
    agent_dark: z.boolean(),
    cost_anomaly: z.boolean(),
  }),
  sources: z.object({
    cron_health: z.enum(["ok", "error", "missing", "unconfigured"]),
    approvals: z.enum(["ok", "error"]),
    agent_dark: z.literal("gated_off"),
    cost_anomaly: z.literal("gated_off"),
  }),
  error: z.string().nullable().optional(),
  warning: z.string().nullable().optional(),
  cache_age_minutes: z.number().nullable().optional(),
});
export type MissionControlAlertsResponse = z.infer<typeof MissionControlAlertsResponse>;

