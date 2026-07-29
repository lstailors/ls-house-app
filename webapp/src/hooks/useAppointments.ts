import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import type {
  StaffAppointment,
  TimeBlock,
  AppointmentsListResponse,
  LSHAgent,
  LSHAppointmentType,
  BlockTimeRequest,
  StaffBookingRequest,
} from "@ls/types";

export function useAppointmentsData(dateFrom: string, dateTo: string, agentUser?: string) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  if (agentUser) params.set("agent_user", agentUser);

  return useQuery<AppointmentsListResponse>({
    queryKey: ["appointments", dateFrom, dateTo, agentUser],
    queryFn: () => api.get<AppointmentsListResponse>(`/api/appointments?${params.toString()}`),
    staleTime: 30_000,
  });
}

export function useLSHAgents() {
  return useQuery<LSHAgent[]>({
    queryKey: ["appointments", "agents"],
    queryFn: () => api.get<LSHAgent[]>("/api/appointments/agents"),
    staleTime: 5 * 60_000,
  });
}

export function useLSHTypes() {
  return useQuery<LSHAppointmentType[]>({
    queryKey: ["appointments", "types"],
    queryFn: () => api.get<LSHAppointmentType[]>("/api/appointments/types"),
    staleTime: 5 * 60_000,
  });
}

export function useBlockTime() {
  const queryClient = useQueryClient();
  return useMutation<{ name: string; subject: string }, Error, BlockTimeRequest>({
    mutationFn: (data) => api.post<{ name: string; subject: string }>("/api/appointments/block", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export function useBookAppointment() {
  const queryClient = useQueryClient();
  return useMutation<{ name: string }, Error, StaffBookingRequest>({
    mutationFn: (data) => api.post<{ name: string }>("/api/appointments/book", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export function useSetAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true },
    Error,
    { name: string; status: "confirm" | "complete" | "no_show" | "cancel" }
  >({
    mutationFn: ({ name, status }) =>
      api.patch<{ ok: true }>(`/api/appointments/${name}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

export type { StaffAppointment, TimeBlock, LSHAgent, LSHAppointmentType };
