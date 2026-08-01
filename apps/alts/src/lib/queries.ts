// Delivery-only data hooks for alts FOH (trimmed from webapp port — P3-9).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { useActiveLocation, locationQueryString } from "@alts/lib/locationContext";
import type { Customer, Delivery } from "@ls/types";

export function useDeliveries() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["deliveries", activeLocationId],
    queryFn: () =>
      api.get<Delivery[]>(`/api/deliveries${locationQueryString(activeLocationId)}`),
    staleTime: 60_000,
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
  apt?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
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
    },
  });
}

export function useDeliveryAnomalies(enabled: boolean) {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["delivery-anomalies", activeLocationId],
    queryFn: () =>
      api.get<
        Array<{
          deliveryId: string;
          customer: string;
          status: string;
          issue: string;
          severity: "high" | "medium" | "low";
          recommendation: string;
        }>
      >(`/api/deliveries/anomalies${locationQueryString(activeLocationId)}`),
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
      api.get<{
        summary: string;
        highlights: string[];
        flagged: string[];
        totalDeliveries: number;
        model: string;
      }>(`/api/deliveries/daily-ops-summary${locationQueryString(activeLocationId)}`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDeliveryGenerateMessage() {
  return useMutation({
    mutationFn: (input: {
      id: string;
      type: string;
      channel: "sms" | "email";
      customContext?: string;
    }) => {
      const { id, ...body } = input;
      return api.post<{
        deliveryId: string;
        message: string;
        type: string;
        channel: string;
        model: string;
      }>(`/api/deliveries/${id}/generate-message`, body);
    },
  });
}

export function useDeliveryEstimateTime(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["delivery-estimate-time", id],
    queryFn: () =>
      api.get<{
        deliveryId: string;
        estimate: string;
        confidence: "high" | "medium" | "low";
        reasoning: string;
        model: string;
      }>(`/api/deliveries/${id}/estimate-time`),
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
    queryFn: () =>
      api.get<{
        photo1: string | null;
        photo2: string | null;
        photo3: string | null;
        signature: string | null;
      }>(`/api/deliveries/${id}/proof-url`),
    enabled: !!id,
    staleTime: Infinity,
  });
}
