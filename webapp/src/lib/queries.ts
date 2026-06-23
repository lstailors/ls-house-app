// Centralized data hooks. Every page reads through here so a future swap to
// Data layer: ERPNext via backend API routes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
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
} from "./types";

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
