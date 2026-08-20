// Centralized data hooks. Every page reads through here so a future swap to
// Data layer: ERPNext via backend API routes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { useActiveLocation, locationQueryString } from "./locationContext";
import type {
  Alteration,
  Communication,
  CustomOrder,
  HDTicket,
  HDTicketDetail,
  Customer,
  DashboardKpis,
  Delivery,
  FabricPricing,
  Invoice,
  Location,
  Profile,
  SalesOrder,
  StyleOption,
  Tailor,
  YZTicket,
  YZOrder,
  YZProductionBrief,
  KanbanTask,
  MissionControlBoardResponse,
  MissionControlAlertsResponse,
} from "@ls/types";

export interface DepositReceipt {
  provider: string;
  status: string;
  amount: number;
  transactionId: string;
  last4: string;
  timestamp: string;
}

export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get<Location[]>("/api/locations"),
    staleTime: 10 * 60_000,
  });
}

export function useDashboardKpis() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["dashboard", "kpis", activeLocationId],
    queryFn: () =>
      api.get<DashboardKpis>(`/api/dashboard/kpis${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export function useFinancials() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["financials", activeLocationId],
    queryFn: () =>
      api.get<{
        revenue: number;
        revenueMTD: number;
        revenueLastMonth: number;
        revenueChange: number;
        salesOrderCount: number;
        avgOrderValue: number;
        invoicesTotal: number;
        invoiceCount: number;
        depositsPendingTotal: number;
        depositsPendingCount: number;
        cogs: number;
        grossProfit: number;
        marginPct: number;
        arOutstanding: number;
        trend: Array<{ month: string; revenue: number; orders: number }>;
        pipeline: Array<{ stage: string; label: string; count: number; value: number }>;
        topGarments: Array<{ type: string; units: number; revenue: number; avgPrice: number }>;
        topCustomers: Array<{ name: string; orders: number; revenue: number }>;
        salesByRep: Array<{ name: string; orders: number; revenue: number }>;
      }>(`/api/dashboard/financials${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export interface TenderVarianceData {
  period: { from: string; to: string; days: number };
  square: {
    btGross: number;
    payoutTotal: number;
    feeTotal: number;
    unreconciledCount: number;
    unreconciledAmt: number;
    totalBtCount: number;
  };
  erp: {
    squareTotal: number;
    receiveTotal: number;
  };
  variance: {
    amount: number;
    pct: number;
    status: "clear" | "minor" | "investigate";
  };
  tenderMix: Array<{ mode: string; amount: number; pct: number }>;
  spark: Array<{ date: string; square: number }>;
}

export function useTenderVariance(days: number = 30) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["tender-variance", activeLocationId, days],
    queryFn: () =>
      api.get<TenderVarianceData>(
        `/api/dashboard/tender-variance?days=${days}${activeLocationId ? `&locationId=${activeLocationId}` : ""}`,
      ),
    staleTime: 120_000,
  });
}

export function useOwnerDashboard(range: string = "30d") {
  return useQuery({
    queryKey: ["owner-dashboard", range],
    queryFn: () => api.get<unknown>(`/api/dashboard/owner?range=${range}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAlterations() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["alterations", activeLocationId],
    queryFn: () =>
      api.get<Alteration[]>(`/api/alterations${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export function useCustomOrders() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["custom-orders", activeLocationId],
    queryFn: () =>
      api.get<CustomOrder[]>(
        `/api/custom-orders${locationQueryString(activeLocationId)}`,
      ),
    staleTime: 60_000,
  });
}

export function useCustomOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["custom-orders", "detail", id],
    queryFn: () => api.get<CustomOrder>(`/api/custom-orders/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCustomers() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["customers", activeLocationId],
    queryFn: () =>
      api.get<Customer[]>(`/api/customers${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export function useSalesOrders(status?: string) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["sales-orders", status ?? "active", activeLocationId],
    queryFn: () =>
      api
        .get<{ data: SalesOrder[]; total: number }>(
          `/api/sales-orders?status=${status ?? "active"}&limit=100`,
        )
        .then((r) => (r as any).data ?? r),
    staleTime: 60_000,
  });
}

export function useInvoices() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["invoices", activeLocationId],
    queryFn: () =>
      api.get<Invoice[]>(`/api/invoices${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export function useDeliveries() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["deliveries", activeLocationId],
    queryFn: () =>
      api.get<Delivery[]>(`/api/deliveries${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
  });
}

export function useCommunications(customerId?: string) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["communications", activeLocationId, customerId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeLocationId) params.set("locationId", activeLocationId);
      if (customerId) params.set("customerId", customerId);
      const q = params.toString();
      return api.get<Communication[]>(`/api/communications${q ? `?${q}` : ""}`);
    },
    staleTime: 60_000,
  });
}

export function useFabrics() {
  return useQuery({
    queryKey: ["fabrics"],
    queryFn: () => api.get<FabricPricing[]>("/api/reference/fabrics"),
    staleTime: 10 * 60_000,
  });
}

export function useStyleOptions() {
  return useQuery({
    queryKey: ["styles"],
    queryFn: () => api.get<StyleOption[]>("/api/reference/styles"),
    staleTime: 10 * 60_000,
  });
}

export function useTailors() {
  return useQuery({
    queryKey: ["tailors"],
    queryFn: () => api.get<Tailor[]>("/api/reference/tailors"),
    staleTime: 10 * 60_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────

export function useCreateCustomOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<CustomOrder>("/api/custom-orders", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export interface Transition {
  action: string;
  label?: string;
}

export function useAlterationDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["alterations", "detail", id],
    queryFn: () => api.get<Alteration>(`/api/alterations/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAlterationTransitions(id: string | undefined) {
  return useQuery({
    queryKey: ["alterations", "transitions", id],
    queryFn: () => api.get<Transition[]>(`/api/alterations/${id}/transitions`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCreateAlteration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<Alteration>("/api/alterations", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alterations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useTakeDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { customOrderId: string; amount: number }) =>
      api.post<{ order: CustomOrder; receipt: DepositReceipt }>(
        "/api/custom-orders/deposit",
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      status?: string;
      proofOfDeliveryUrl?: string | null;
      driverId?: string | null;
      scheduledAt?: string | null;
      podMethod?: string;
      receivedBy?: string;
      signatureName?: string;
    }) => {
      const { id, ...patch } = input;
      return api.patch<Delivery>(`/api/deliveries/${id}`, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCustomerSearch(q: string) {
  return useQuery({
    queryKey: ["customers", "search", q],
    queryFn: () => api.get<Customer[]>(`/api/customers/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useCreateDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<Delivery>("/api/deliveries", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface DeliverySearchResult {
  type: "customer" | "alteration" | "order" | "new";
  id: string;
  label: string;
  sublabel?: string;
  customer?: string;
  customerName?: string;
  phone?: string | null;
  address?: string | null;
  garmentSummary?: string | null;
  orderRef?: string | null;
  alterationTicket?: string | null;
}

export function useDeliverySearchContext(q: string) {
  return useQuery({
    queryKey: ["delivery-search-context", q],
    queryFn: () =>
      api.get<DeliverySearchResult[]>(`/api/deliveries/search-context?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useDeliveryCandidates() {
  return useQuery({
    queryKey: ["delivery-candidates"],
    queryFn: () => api.get<any[]>("/api/deliveries/candidates"),
    staleTime: 30_000,
  });
}

export function useMarkDelivered() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      podMethod: string;
      receivedBy?: string;
      signatureName?: string;
      notes?: string;
      photoUrls?: string[];
      signatureImageUrl?: string;
      gpsLat?: number;
      gpsLng?: number;
      gpsAccuracy?: number;
    }) => {
      const { id, ...body } = input;
      return api.patch<Delivery>(`/api/deliveries/${id}/pod`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeliveryAnomalies(enabled: boolean) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["delivery-anomalies", activeLocationId],
    queryFn: () =>
      api.get<Array<{ deliveryId: string; customer: string; status: string; issue: string; severity: "high" | "medium" | "low"; recommendation: string }>>(
        `/api/deliveries/anomalies${locationQueryString(activeLocationId)}`,
      ),
    enabled,
    staleTime: 3 * 60_000,
    retry: false,
  });
}

export function useDeliveryDailyOpsSummary(enabled: boolean) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["delivery-daily-ops", activeLocationId],
    queryFn: () =>
      api.get<{ summary: string; highlights: string[]; flagged: string[]; totalDeliveries: number; model: string }>(
        `/api/deliveries/daily-ops-summary${locationQueryString(activeLocationId)}`,
      ),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDeliveryGenerateMessage() {
  return useMutation({
    mutationFn: (input: { id: string; type: string; channel: "sms" | "email"; customContext?: string }) => {
      const { id, ...body } = input;
      return api.post<{ deliveryId: string; message: string; type: string; channel: string; model: string }>(
        `/api/deliveries/${id}/generate-message`,
        body,
      );
    },
  });
}

export function useDeliveryEstimateTime(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["delivery-estimate-time", id],
    queryFn: () =>
      api.get<{ deliveryId: string; estimate: string; confidence: "high" | "medium" | "low"; reasoning: string; model: string }>(
        `/api/deliveries/${id}/estimate-time`,
      ),
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDeliveryAiSuggest(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["delivery-ai-suggest", id],
    queryFn: () =>
      api.get<{ deliveryId: string; status: string; reason: string; model: string }>(
        `/api/deliveries/${id}/suggest-status`,
      ),
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDeliveryAiSummary(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["delivery-ai-summary", id],
    queryFn: () =>
      api.get<{ deliveryId: string; summary: string; model: string }>(
        `/api/deliveries/${id}/summarize-timeline`,
      ),
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDeliveryProofUrls(id: string | null) {
  return useQuery({
    queryKey: ["delivery-proof", id],
    queryFn: () => api.get<{ photo1: string | null; photo2: string | null; photo3: string | null; signature: string | null }>(`/api/deliveries/${id}/proof-url`),
    enabled: !!id,
    staleTime: Infinity, // Public URLs from ERP never expire
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<Profile[]>("/api/admin/users"),
    staleTime: 2 * 60_000,
  });
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () =>
      api.get<{
        totalUsers: number;
        totalLocations: number;
        totalCustomers: number;
        totalCustomOrders: number;
        totalAlterations: number;
        totalDeliveries: number;
      }>("/api/admin/overview"),
    staleTime: 2 * 60_000,
  });
}

// ─── Maestro ────────────────────────────────────────────────────────────────

export function useMaestroBrief() {
  return useQuery({
    queryKey: ["maestro", "brief"],
    queryFn: () => api.get<any>("/api/maestro/brief"),
    refetchInterval: 5 * 60 * 1000, // 5 min
    staleTime: 4 * 60_000,
  });
}

export function useDailyEspresso() {
  return useQuery({
    queryKey: ["espresso"],
    queryFn: () => api.get<any>("/api/espresso"),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 minutes
    staleTime: 2 * 60 * 1000,
  });
}

export function useMaestroApprovals() {
  return useQuery({
    queryKey: ["maestro", "approvals"],
    queryFn: () => api.get<any[]>("/api/maestro/approvals"),
    refetchInterval: 60 * 1000, // 1 min
    staleTime: 30_000,
  });
}

export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "approve" | "deny"; notes?: string }) =>
      api.post(`/api/maestro/approvals/${id}/${action}`, notes ? { notes } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maestro", "approvals"] });
      qc.invalidateQueries({ queryKey: ["agents", "approvals", "pending"] });
    },
  });
}

// ─── Sofia ───────────────────────────────────────────────────────────────────

export function useSofiaConversations() {
  return useQuery({
    queryKey: ["sofia", "conversations"],
    queryFn: () => api.get<any[]>("/api/sofia/conversations"),
    refetchInterval: 30 * 1000,
    staleTime: 15_000,
  });
}

export function useSofiaThread(phone: string | null) {
  return useQuery({
    queryKey: ["sofia", "thread", phone],
    queryFn: () => api.get<any[]>(`/api/sofia/conversations/${encodeURIComponent(phone!)}`),
    enabled: !!phone,
    staleTime: 15_000,
  });
}

export function useSofiaHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, notes }: { phone: string; notes?: string }) =>
      api.post(`/api/sofia/conversations/${encodeURIComponent(phone)}/handoff`, notes ? { notes } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sofia"] }),
  });
}

export function useSofiaVoiceApprovals() {
  return useQuery({
    queryKey: ["sofia", "voice-approvals"],
    queryFn: () => api.get<any[]>("/api/sofia/voice-approvals"),
    refetchInterval: 60 * 1000,
    staleTime: 30_000,
  });
}

// "Ask Sofia" staff chat panel — forces Sofia's ASSISTANT MODE brain (same
// no-draft/never-lie guardrails Carl gets via SMS) over authenticated HTTP.
// Returns Sofia's reply text plus a structured list of tool calls/actions
// (e.g. which customer was resolved, what SMS was sent, twilio_sid) so the
// UI can render a "what Sofia did" receipt, not just a chat bubble.
export type SofiaChatAction = {
  tool: string;
  ok: boolean;
  sent_to: string | null;
  recipient_name: string | null;
  message: string | null;
  twilio_sid: string | null;
  message_name: string | null;
  error: string | null;
};

export type SofiaChatResponse = {
  reply: string;
  tool_calls: { name: string; args: Record<string, unknown>; result: unknown }[];
  actions: SofiaChatAction[];
  lookups: { tool: string; query: unknown; result: unknown }[];
};

export function useSofiaChat() {
  return useMutation({
    mutationFn: (input: {
      message: string;
      history?: { role: "user" | "assistant" | "staff" | "sofia"; content?: string; text?: string }[];
      context_phone?: string | null;
    }) =>
      api.post<SofiaChatResponse>("/api/sofia/chat", {
        message: input.message,
        history: input.history,
        context_phone: input.context_phone ?? null,
      }),
  });
}


export function useMaestroApprovalCount() {
  return useQuery({
    queryKey: ["maestro", "approvals", "count"],
    queryFn: async () => {
      const items = await api.get<any[]>("/api/maestro/approvals");
      return (items ?? []).filter((i: any) => i.status === "pending" || i.status === "awaiting_second").length;
    },
    refetchInterval: 60 * 1000,
    staleTime: 30_000,
  });
}

// ─── Agents (Mission Control) ─────────────────────────────────────────────────

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<any[]>("/api/agents"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAgent(slug: string | undefined) {
  return useQuery({
    queryKey: ["agents", slug],
    queryFn: () => api.get<any>(`/api/agents/${slug}`),
    enabled: !!slug,
    refetchInterval: 15_000,
    staleTime: 7_000,
  });
}

export function useAgentEvents(slug: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ["agents", slug, "events", limit],
    queryFn: () => api.get<any[]>(`/api/agents/${slug}/events?limit=${limit}`),
    enabled: !!slug,
    refetchInterval: 15_000,
    staleTime: 7_000,
  });
}

export function useAgentTasks(slug: string | undefined, status?: string) {
  return useQuery({
    queryKey: ["agents", slug, "tasks", status],
    queryFn: () =>
      api.get<any[]>(`/api/agents/${slug}/tasks${status ? `?status=${status}` : ""}`),
    enabled: !!slug,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["agents", "approvals", "pending"],
    queryFn: () => api.get<{ byAgent: Record<string, any[]>; total: number }>("/api/agents/approvals/pending"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAgentBriefs(limit = 20) {
  return useQuery({
    queryKey: ["agents", "briefs", limit],
    queryFn: () => api.get<any[]>(`/api/agents/briefs?limit=${limit}`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useDelegateTask(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; description?: string; priority?: string; due_at?: string }) =>
      api.post<any>(`/api/agents/${slug}/tasks`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", slug, "tasks"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.patch<any>(`/api/agents/${slug}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", slug] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useAgentMessages(slug: string | undefined) {
  return useQuery({
    queryKey: ["agents", slug, "messages"],
    queryFn: () => api.get<any[]>(`/api/agents/${slug}/messages?limit=50`),
    enabled: !!slug,
    staleTime: 10_000,
  });
}

export function useSendAgentMessage(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.post<any>(`/api/agents/${slug}/messages`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", slug, "messages"] });
    },
  });
}

// ─── SPEC 069 one-shot agent command console ─────────────────────────────────

export type AgentCommandStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "timeout"
  | "cancelled";

export type AgentCommandRun = {
  id: string;
  agent_slug: string;
  command: string;
  status: AgentCommandStatus;
  session_id: string | null;
  pid: number | string | null;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  format: "code" | "prose" | null;
  error: string | null;
  created_at: string | null;
  timeout_s: number;
  source_table?: string;
};

export function useAgentCommand(slug: string | undefined, commandId: string | null | undefined) {
  return useQuery({
    queryKey: ["agents", slug, "commands", commandId],
    queryFn: () => api.get<AgentCommandRun>(`/api/agents/${slug}/commands/${commandId}`),
    enabled: !!slug && !!commandId,
    staleTime: 1_000,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (!s || s === "queued" || s === "running") return 1_500;
      return false;
    },
  });
}

export function useSendAgentCommand(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { prompt: string; idempotency_key?: string; timeout_s?: number }) =>
      api.post<AgentCommandRun>(`/api/agents/${slug}/commands`, input),
    onSuccess: (data) => {
      if (data?.id) {
        qc.setQueryData(["agents", slug, "commands", data.id], data);
      }
      qc.invalidateQueries({ queryKey: ["agents", slug, "events"] });
    },
  });
}

export function useCancelAgentCommand(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commandId: string) =>
      api.post<AgentCommandRun>(`/api/agents/${slug}/commands/${commandId}/cancel`),
    onSuccess: (data) => {
      if (data?.id) {
        qc.setQueryData(["agents", slug, "commands", data.id], data);
      }
    },
  });
}

// ─── Profile & Password ───────────────────────────────────────────────────────

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; image?: string }) => api.patch<any>("/api/me", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (password: string) => api.post<any>("/api/me/password", { password }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string; role: string; locationId?: string }) =>
      api.post<any>("/api/admin/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUser(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; role?: string; locationId?: string; isActive?: boolean }) =>
      api.patch<any>(`/api/admin/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useResetUserPassword(id: string | undefined) {
  return useMutation({
    mutationFn: (password: string) => api.post<any>(`/api/admin/users/${id}/password`, { password }),
  });
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; code: string; address?: string; erpnextCompany?: string }) =>
      api.post<any>("/api/admin/locations", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });
}

export function useUpdateLocation(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; isActive?: boolean; address?: string }) =>
      api.patch<any>(`/api/admin/locations/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });
}

// ─── Mission Control — Costs, Cron, Audit, Live feed ─────────────────────────

export function useAgentCosts(days = 30) {
  return useQuery({
    queryKey: ["agents", "costs", days],
    queryFn: () => api.get<any>(`/api/agents/costs?days=${days}`),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
}

export function useCronJobs() {
  return useQuery({
    queryKey: ["agents", "cron"],
    queryFn: () => api.get<any[]>("/api/agents/cron"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useToggleCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/agents/cron/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", "cron"] }),
  });
}

export function useAuditLog(agentSlug?: string, limit = 100) {
  return useQuery({
    queryKey: ["agents", "audit", agentSlug, limit],
    queryFn: () =>
      api.get<any[]>(`/api/agents/audit?limit=${limit}${agentSlug ? `&agent=${agentSlug}` : ""}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useLiveFeed() {
  return useQuery({
    queryKey: ["agents", "live"],
    queryFn: () => api.get<any[]>("/api/agents/live"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

// ─── Comms Intelligence ───────────────────────────────────────────────────────

export interface CommsData {
  calls: any[];
  recordings: any[];
  smsThreads: any[];
  timeline: any[];
  counts: {
    callsToday: number;
    missedCalls: number;
    totalRecordings: number;
    smsThreads: number;
    unreadSms: number;
  };
}

export function useComms() {
  return useQuery({
    queryKey: ["comms"],
    queryFn: () => api.get<CommsData>("/api/comms"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useSmsThread(phone: string | null) {
  return useQuery({
    queryKey: ["sms-thread", phone],
    queryFn: () => api.get<{ messages: any[]; customer: any }>(`/api/comms/thread/${encodeURIComponent(phone!)}`),
    enabled: !!phone,
    staleTime: 15_000,
  });
}

/** Phase 1 — unified customer timeline (SMS + calls + Plaud). */
export type CommsEvent = {
  id: string;
  source_type: "sms" | "call" | "plaud";
  occurred_at: string;
  erpnext_customer_id: string | null;
  customer_name?: string | null;
  phone?: string | null;
  direction?: string | null;
  summary: string;
  body?: string | null;
  status?: string | null;
  duration_sec?: number | null;
  has_recording?: boolean;
};

export type CommsEventsData = {
  customer: { id: string; name: string; mobile_no?: string | null } | null;
  events: CommsEvent[];
  counts: { sms: number; call: number; plaud: number; all: number };
  sources: string[];
  sensitive_redacted: boolean;
  generatedAt?: string;
};

export function useCommsEvents(opts: {
  customer?: string | null;
  phone?: string | null;
  source?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const customer = opts.customer || null;
  const phone = opts.phone || null;
  const source = opts.source || "all";
  const limit = opts.limit ?? 50;
  const enabled = opts.enabled !== false && !!(customer || phone);

  return useQuery({
    queryKey: ["comms-events", customer, phone, source, limit],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (customer) qs.set("customer", customer);
      if (phone) qs.set("phone", phone);
      qs.set("source", source);
      qs.set("limit", String(limit));
      return api.get<CommsEventsData>(`/api/comms/events?${qs.toString()}`);
    },
    enabled,
    staleTime: 20_000,
  });
}

export function useTaskCount() {
  return useQuery({
    queryKey: ["tasks", "open-count"],
    queryFn: () => api.get<{ count: number; overdue: number }>("/api/tasks/open-count"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAllTasks(status?: string) {
  return useQuery({
    queryKey: ["agents", "tasks", "all", status],
    queryFn: () =>
      api.get<any[]>(`/api/agents/approvals/pending`),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

export function useOpenYZTickets() {
  return useQuery({
    queryKey: ["yz", "open-tickets"],
    queryFn: () => api.get<YZTicket[]>("/api/yz/open-tickets"),
    staleTime: 60_000,
  });
}

// Live YZ Production Tracker orders for the Shop Floor page. Refetches every
// 60s (matching the requested revalidate window); keeps prior data on error so
// the UI can show a stale banner instead of an empty screen.
export function useYzProduction() {
  return useQuery({
    queryKey: ["yz", "production"],
    queryFn: () => api.get<YZOrder[]>("/api/yz/production"),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

// AI production brief for the Shop Floor banner. Refreshes less often than the
// board (AI cost) and keeps prior data so the banner never flashes empty.
export function useYzProductionBrief() {
  return useQuery({
    queryKey: ["yz", "production", "brief"],
    queryFn: () => api.get<YZProductionBrief>("/api/yz/production/brief"),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}

// ── Helpdesk ──────────────────────────────────────────────────────────────

export function useHelpdeskTickets(params?: { status?: string; mine?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.mine) qs.set("mine", "1");
  return useQuery({
    queryKey: ["helpdesk", "tickets", params],
    queryFn: () => api.get<HDTicket[]>(`/api/helpdesk/tickets?${qs}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useHelpdeskTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["helpdesk", "ticket", id],
    queryFn: () => api.get<HDTicketDetail>(`/api/helpdesk/tickets/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useHelpdeskOpenCount() {
  return useQuery({
    queryKey: ["helpdesk", "open-count"],
    queryFn: () => api.get<{ total: number; escalated: number }>("/api/helpdesk/open-count"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useHelpdeskReply(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) =>
      api.post(`/api/helpdesk/tickets/${ticketId}/reply`, { message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["helpdesk", "ticket", ticketId] }),
  });
}

export function useHelpdeskUpdateStatus(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: string) =>
      api.put(`/api/helpdesk/tickets/${ticketId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk"] });
    },
  });
}

export function useHelpdeskCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { subject: string; description?: string; priority?: string; agentGroup?: string }) =>
      api.post<HDTicket>("/api/helpdesk/tickets", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["helpdesk"] }),
  });
}

// ─── Mission Control Board (SPEC 062 Phase 1) ────────────────────────────────
export function useMissionControlBoard(params?: {
  assignee?: string | null;
  blockedOnly?: boolean;
  q?: string;
}) {
  const search = new URLSearchParams();
  if (params?.assignee) search.set("assignee", params.assignee);
  if (params?.blockedOnly) search.set("blockedOnly", "true");
  if (params?.q) search.set("q", params.q);
  const qs = search.toString() ? `?${search}` : "";

  return useQuery({
    queryKey: ["mission-control", "board", params ?? {}],
    queryFn: () =>
      api.get<MissionControlBoardResponse>(`/api/mission-control/board${qs}`),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useMissionControlBoardTask(id: string | undefined) {
  return useQuery({
    queryKey: ["mission-control", "board", "task", id],
    queryFn: () =>
      api.get<{
        task: KanbanTask | null;
        comments: any[];
        events: any[];
        parents: any[];
        children: any[];
      }>(`/api/mission-control/board/${id}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useMissionControlCrons(params?: {
  profile?: string | null;
  status?: string | null;
}) {
  const search = new URLSearchParams();
  if (params?.profile) search.set("profile", params.profile);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString() ? `?${search}` : "";

  return useQuery({
    queryKey: ["mission-control", "crons", params ?? {}],
    queryFn: () => api.get<any>(`/api/mission-control/crons${qs}`),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useMissionControlHistory(params?: {
  agent?: string | null;
  q?: string;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (params?.agent) search.set("agent", params.agent);
  if (params?.q) search.set("q", params.q);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString() ? `?${search}` : "";

  return useQuery({
    queryKey: ["mission-control", "history", params ?? {}],
    queryFn: () => api.get<any>(`/api/mission-control/history${qs}`),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useMissionControlBoardAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      assignee,
      comment,
    }: {
      id: string;
      action: string;
      reason?: string;
      assignee?: string;
      comment?: string;
    }) =>
      api.post<any>(`/api/mission-control/board/${id}/action`, {
        action,
        reason,
        assignee,
        comment,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission-control", "board"] });
    },
  });
}

// SPEC 071 — global Alerts (derived standing state)
export function useMissionControlAlerts() {
  return useQuery({
    queryKey: ["mission-control", "alerts"],
    queryFn: () =>
      api.get<MissionControlAlertsResponse>(`/api/mission-control/alerts`),
    staleTime: 20_000,
    refetchInterval: 45_000,
    // Keep last-known on error so badge doesn't go silent (SPEC §4.3)
    placeholderData: (prev) => prev,
  });
}

// SPEC 067 — dedicated Approvals (LSH Agent Approval + legacy queue)
export function useMissionControlApprovals(params?: {
  view?: "queue" | "history";
  risk?: string | null;
  agent?: string | null;
  financialOnly?: boolean;
  q?: string | null;
  days?: number;
  outcome?: string | null;
}) {
  const search = new URLSearchParams();
  if (params?.view) search.set("view", params.view);
  if (params?.risk) search.set("risk", params.risk);
  if (params?.agent) search.set("agent", params.agent);
  if (params?.financialOnly) search.set("financialOnly", "true");
  if (params?.q) search.set("q", params.q);
  if (params?.days != null) search.set("days", String(params.days));
  if (params?.outcome) search.set("outcome", params.outcome);
  const qs = search.toString() ? `?${search}` : "";

  return useQuery({
    queryKey: ["mission-control", "approvals", params],
    queryFn: () => api.get<any>(`/api/mission-control/approvals${qs}`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMissionControlApprovalDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      notes,
      payload,
    }: {
      id: string;
      action: "approve" | "reject" | "edit_approve";
      notes?: string;
      payload?: unknown;
    }) =>
      api.post(`/api/mission-control/approvals/${encodeURIComponent(id)}/decide`, {
        action,
        notes,
        payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission-control", "approvals"] });
      qc.invalidateQueries({ queryKey: ["maestro", "approvals"] });
      qc.invalidateQueries({ queryKey: ["agents", "approvals", "pending"] });
      qc.invalidateQueries({ queryKey: ["mission-control", "alerts"] });
    },
  });
}

// SPEC 072 — Hermes Desktop / Dashboard mirror
export function useHermesMirrorStatus() {
  return useQuery({
    queryKey: ["mission-control", "hermes", "status"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/status`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useHermesMirrorSessions(enabled = true, profile?: string | null) {
  const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["mission-control", "hermes", "sessions", profile || "all"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/sessions${qs}`),
    staleTime: 20_000,
    enabled,
  });
}

export function useHermesMirrorSkills(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "skills"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/skills`),
    staleTime: 60_000,
    enabled,
  });
}

export function useHermesMirrorCron(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "cron"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/cron`),
    staleTime: 30_000,
    enabled,
  });
}

export function useHermesMirrorMcp(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "mcp"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/mcp`),
    staleTime: 60_000,
    enabled,
  });
}

export function useHermesMirrorArtifacts(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "artifacts"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/artifacts`),
    staleTime: 30_000,
    enabled,
  });
}

export function useHermesMirrorMemory(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "memory"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/memory`),
    staleTime: 60_000,
    enabled,
  });
}

export function useHermesMirrorSessionStats(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "sessions", "stats"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/sessions/stats`),
    staleTime: 30_000,
    enabled,
  });
}

export function useHermesMirrorSessionMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "sessions", sessionId, "messages"],
    queryFn: () =>
      api.get<any>(
        `/api/mission-control/hermes/sessions/${encodeURIComponent(sessionId!)}/messages?limit=100`,
      ),
    staleTime: 15_000,
    enabled: Boolean(sessionId),
  });
}

export function useHermesMirrorAnalytics(days = 14, enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "analytics", days],
    queryFn: () =>
      api.get<any>(`/api/mission-control/hermes/analytics?days=${days}`),
    staleTime: 60_000,
    enabled,
  });
}

export function useHermesMirrorModels(days = 14, enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "analytics", "models", days],
    queryFn: () =>
      api.get<any>(`/api/mission-control/hermes/analytics/models?days=${days}`),
    staleTime: 60_000,
    enabled,
  });
}

// SPEC 072 Phase 4
export function useHermesSessionSearch(q: string, profile?: string | null, enabled = true) {
  const qs = new URLSearchParams({ q, limit: "30" });
  if (profile) qs.set("profile", profile);
  return useQuery({
    queryKey: ["mission-control", "hermes", "sessions", "search", q, profile || "all"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/sessions/search?${qs}`),
    staleTime: 15_000,
    enabled: enabled && q.trim().length >= 2,
  });
}

export function useHermesProfiles(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "profiles"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/profiles`),
    staleTime: 120_000,
    enabled,
  });
}

export function useHermesLearningGraph(enabled = true, profile?: string | null) {
  const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["mission-control", "hermes", "learning-graph", profile || "all"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/learning/graph${qs}`),
    staleTime: 60_000,
    enabled,
  });
}

export function useHermesCronDeliveryTargets(enabled = true) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "cron", "delivery-targets"],
    queryFn: () => api.get<any>(`/api/mission-control/hermes/cron/delivery-targets`),
    staleTime: 120_000,
    enabled,
  });
}

export function useHermesCronJobRuns(jobId: string | null) {
  return useQuery({
    queryKey: ["mission-control", "hermes", "cron", "runs", jobId],
    queryFn: () =>
      api.get<any>(`/api/mission-control/hermes/cron/jobs/${encodeURIComponent(jobId!)}/runs`),
    staleTime: 20_000,
    enabled: Boolean(jobId),
  });
}

export function useHermesCronCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      schedule: string;
      prompt?: string;
      deliver?: string;
      profile?: string;
      script?: string;
      no_agent?: boolean;
    }) => api.post<any>(`/api/mission-control/hermes/cron/jobs`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission-control", "hermes", "cron"] });
    },
  });
}

export function useHermesCronAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; action: "pause" | "resume" | "trigger"; profile?: string }) => {
      const qs = input.profile ? `?profile=${encodeURIComponent(input.profile)}` : "";
      return api.post<any>(
        `/api/mission-control/hermes/cron/jobs/${encodeURIComponent(input.id)}/${input.action}${qs}`,
        {},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission-control", "hermes", "cron"] });
    },
  });
}

export function useHermesCronUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      updates: Record<string, unknown>;
      profile?: string;
    }) =>
      api.put<any>(`/api/mission-control/hermes/cron/jobs/${encodeURIComponent(input.id)}`, {
        updates: input.updates,
        profile: input.profile,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission-control", "hermes", "cron"] });
    },
  });
}

// ─── Logistics (Marco TileOS) ─────────────────────────────────────────────────

export interface LogisticsCycleTimes {
  weeks: string[];
  nyc: (number | null)[];
  hou: (number | null)[];
  summary: {
    nyc_avg: number | null;
    hou_avg: number | null;
    nyc_trend: number;
    hou_trend: number;
    total_shipments: number;
    has_hou_data: boolean;
  };
}

export interface LogisticsSummary {
  total_open: number;
  in_transit: number;
  exceptions: number;
  in_customs: number;
}

export function useLogisticsCycleTimes() {
  return useQuery({
    queryKey: ["logistics", "cycle-times"],
    queryFn: () => api.get<LogisticsCycleTimes>("/api/logistics/cycle-times"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

export function useLogisticsSummary() {
  return useQuery({
    queryKey: ["logistics", "summary"],
    queryFn: () => api.get<LogisticsSummary>("/api/logistics/summary"),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
}
