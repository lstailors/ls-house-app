// Centralized data hooks. Every page reads through here so a future swap to
// Supabase client is a one-file change.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useActiveLocation, locationQueryString } from "./locationContext";
import type {
  Alteration,
  Communication,
  CustomOrder,
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
  });
}

export function useDashboardKpis() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["dashboard", "kpis", activeLocationId],
    queryFn: () =>
      api.get<DashboardKpis>(`/api/dashboard/kpis${locationQueryString(activeLocationId)}`),
  });
}

export function useFinancials() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["financials", activeLocationId],
    queryFn: () =>
      api.get<{
        revenue: number;
        salesOrderCount: number;
        invoicesTotal: number;
        invoiceCount: number;
        depositsPendingTotal: number;
        depositsPendingCount: number;
        cogs: number;
        grossProfit: number;
      }>(`/api/dashboard/financials${locationQueryString(activeLocationId)}`),
  });
}

export function useAlterations() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["alterations", activeLocationId],
    queryFn: () =>
      api.get<Alteration[]>(`/api/alterations${locationQueryString(activeLocationId)}`),
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
  });
}

export function useCustomOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["custom-orders", "detail", id],
    queryFn: () => api.get<CustomOrder>(`/api/custom-orders/${id}`),
    enabled: !!id,
  });
}

export function useCustomers() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["customers", activeLocationId],
    queryFn: () =>
      api.get<Customer[]>(`/api/customers${locationQueryString(activeLocationId)}`),
  });
}

export function useSalesOrders() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["sales-orders", activeLocationId],
    queryFn: () =>
      api.get<SalesOrder[]>(
        `/api/sales-orders${locationQueryString(activeLocationId)}`,
      ),
  });
}

export function useInvoices() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["invoices", activeLocationId],
    queryFn: () =>
      api.get<Invoice[]>(`/api/invoices${locationQueryString(activeLocationId)}`),
  });
}

export function useDeliveries() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["deliveries", activeLocationId],
    queryFn: () =>
      api.get<Delivery[]>(`/api/deliveries${locationQueryString(activeLocationId)}`),
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
  });
}

export function useFabrics() {
  return useQuery({
    queryKey: ["fabrics"],
    queryFn: () => api.get<FabricPricing[]>("/api/reference/fabrics"),
  });
}

export function useStyleOptions() {
  return useQuery({
    queryKey: ["styles"],
    queryFn: () => api.get<StyleOption[]>("/api/reference/styles"),
  });
}

export function useTailors() {
  return useQuery({
    queryKey: ["tailors"],
    queryFn: () => api.get<Tailor[]>("/api/reference/tailors"),
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
      pod_method: string;
      received_by?: string;
      signature_name?: string;
      notes?: string;
      pod_photo_1_path?: string;
      pod_photo_2_path?: string;
      pod_photo_3_path?: string;
      signature_image_path?: string;
      gps_latitude?: number;
      gps_longitude?: number;
      gps_accuracy_meters?: number;
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

export function useDeliveryProofUrls(id: string | null) {
  return useQuery({
    queryKey: ["delivery-proof", id],
    queryFn: () => api.get<{ photo1: string | null; photo2: string | null; photo3: string | null; signature: string | null }>(`/api/deliveries/${id}/proof-url`),
    enabled: !!id,
    staleTime: 50 * 60 * 1000, // 50 min (URLs expire in 60 min)
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<Profile[]>("/api/admin/users"),
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
  });
}

// ─── Maestro ────────────────────────────────────────────────────────────────

export function useMaestroBrief() {
  return useQuery({
    queryKey: ["maestro", "brief"],
    queryFn: () => api.get<any>("/api/maestro/brief"),
    refetchInterval: 5 * 60 * 1000, // 5 min
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
  });
}

export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "approve" | "deny"; notes?: string }) =>
      api.post(`/api/maestro/approvals/${id}/${action}`, notes ? { notes } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maestro", "approvals"] }),
  });
}

// ─── Sofia ───────────────────────────────────────────────────────────────────

export function useSofiaConversations() {
  return useQuery({
    queryKey: ["sofia", "conversations"],
    queryFn: () => api.get<any[]>("/api/sofia/conversations"),
    refetchInterval: 30 * 1000,
  });
}

export function useSofiaThread(phone: string | null) {
  return useQuery({
    queryKey: ["sofia", "thread", phone],
    queryFn: () => api.get<any[]>(`/api/sofia/conversations/${encodeURIComponent(phone!)}`),
    enabled: !!phone,
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
  });
}

// ─── Agents (Mission Control) ─────────────────────────────────────────────────

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<any[]>("/api/agents"),
    refetchInterval: 30_000,
  });
}

export function useAgent(slug: string | undefined) {
  return useQuery({
    queryKey: ["agents", slug],
    queryFn: () => api.get<any>(`/api/agents/${slug}`),
    enabled: !!slug,
    refetchInterval: 15_000,
  });
}

export function useAgentEvents(slug: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ["agents", slug, "events", limit],
    queryFn: () => api.get<any[]>(`/api/agents/${slug}/events?limit=${limit}`),
    enabled: !!slug,
    refetchInterval: 15_000,
  });
}

export function useAgentTasks(slug: string | undefined, status?: string) {
  return useQuery({
    queryKey: ["agents", slug, "tasks", status],
    queryFn: () =>
      api.get<any[]>(`/api/agents/${slug}/tasks${status ? `?status=${status}` : ""}`),
    enabled: !!slug,
    refetchInterval: 30_000,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["agents", "approvals", "pending"],
    queryFn: () => api.get<{ byAgent: Record<string, any[]>; total: number }>("/api/agents/approvals/pending"),
    refetchInterval: 30_000,
  });
}

export function useAgentBriefs(limit = 20) {
  return useQuery({
    queryKey: ["agents", "briefs", limit],
    queryFn: () => api.get<any[]>(`/api/agents/briefs?limit=${limit}`),
    refetchInterval: 60_000,
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
    staleTime: 0,
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
