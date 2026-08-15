/** Map ERP snapshot rows into the shapes each alts page already expects. */

export function invoiceToUi(row: Record<string, unknown>) {
  return {
    id: String(row.name ?? row.id ?? ""),
    name: String(row.name ?? row.id ?? ""),
    erpnextId: String(row.name ?? ""),
    customer: row.customer ? { id: String(row.customer), name: String(row.customer_name ?? "") } : null,
    customerName: (row.customer_name as string | null) ?? null,
    status: String(row.status ?? "unpaid").toLowerCase() === "paid" ? "paid" : "unpaid",
    kind: "alteration" as const,
    grandTotal: Number(row.grand_total) || 0,
    outstandingAmount: Number(row.outstanding_amount) || 0,
    postingDate: (row.posting_date as string | null) ?? null,
    dueDate: (row.due_date as string | null) ?? null,
  };
}

export function houseToUi(row: Record<string, unknown>) {
  return {
    id: String(row.name ?? row.id ?? ""),
    erpName: String(row.name ?? ""),
    customerId: row.customer ? String(row.customer) : undefined,
    customer: { name: row.customer_name ? String(row.customer_name) : undefined },
    status: String(row.status ?? row.order_status ?? ""),
    quotedPrice: Number(row.order_total) || 0,
  };
}

export function qcToUi(row: Record<string, unknown>) {
  return {
    id: String(row.name ?? row.id ?? ""),
    name: row.name ? String(row.name) : null,
    customerName: row.customer_name ? String(row.customer_name) : null,
    garmentSummary: row.garment_summary ? String(row.garment_summary) : null,
    qcResult: row.qc_result ? String(row.qc_result) : null,
    result: row.result ? String(row.result) : null,
    orderStatus: row.status ? String(row.status) : null,
  };
}

export function appointmentToUi(row: Record<string, unknown>) {
  return {
    name: String(row.name ?? ""),
    scheduledTime: String(row.scheduled_time ?? row.scheduledTime ?? ""),
    status: String(row.status ?? "Open"),
    assignedAgent: row.assigned_agent ? String(row.assigned_agent) : null,
    customerName: String(row.customer_name ?? row.customerName ?? ""),
    customerPhone: row.customer_phone_number
      ? String(row.customer_phone_number)
      : row.customer_phone
        ? String(row.customer_phone)
        : null,
    appointmentType: row.custom_appointment_type
      ? String(row.custom_appointment_type)
      : row.appointmentType
        ? String(row.appointmentType)
        : null,
  };
}

export function eventToHouse(row: Record<string, unknown>) {
  return {
    id: String(row.name ?? row.id ?? ""),
    feed: "nyc_appointments",
    title: String(row.subject ?? row.title ?? ""),
    start: String(row.starts_on ?? row.start ?? ""),
    status: row.status ? String(row.status) : undefined,
    erpName: String(row.name ?? ""),
  };
}

export function customerToList(row: Record<string, unknown>) {
  const name = String(row.customer_name ?? row.name ?? "");
  return {
    id: String(row.name ?? row.id ?? ""),
    customerNumber: row.name ? String(row.name) : null,
    name,
    firstName: null as string | null,
    lastName: null as string | null,
    phone: row.mobile_no ? String(row.mobile_no) : row.phone ? String(row.phone) : null,
    email: row.email_id ? String(row.email_id) : row.email ? String(row.email) : null,
    company: null as string | null,
    titleRole: null as string | null,
    locationId: null as string | null,
    status: "Active",
    vipTier: "Standard",
    notes: null as string | null,
    tags: [] as string[],
    casaTier: null as string | null,
    createdAt: String(row.modified ?? ""),
    updatedAt: String(row.modified ?? ""),
  };
}

export function customerToDetail(row: Record<string, unknown>) {
  const list = customerToList(row);
  return {
    ...list,
    preferredName: null,
    profession: null,
    pronouns: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    stylePreferences: null,
    fitNotes: null,
    lifestyleNotes: null,
    birthday: null,
    anniversary: null,
    communicationPref: null,
    preferredContact: "phone",
    smsOptedOut: false,
    paymentPreference: null,
    creditTerms: null,
    referralCode: null,
    referralCredits: 0,
    erpnextCustomerId: list.id,
    dossier: null,
  };
}

export function customerToHit(row: Record<string, unknown>) {
  return {
    id: String(row.name ?? row.id ?? ""),
    name: String(row.customer_name ?? row.name ?? ""),
    phone: String(row.mobile_no ?? row.phone ?? ""),
    email: String(row.email_id ?? row.email ?? ""),
    addressLine: "",
  };
}

export function dayKey(raw?: string | null) {
  if (!raw) return "";
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = Date.parse(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") : `${s}T12:00:00`);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function inDayRange(raw: string | null | undefined, from: string, to: string) {
  const d = dayKey(raw);
  return !!d && d >= from && d <= to;
}

export function matchesCustomer(row: Record<string, unknown>, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  const blob = [row.customer_name, row.name, row.mobile_no, row.phone, row.email_id, row.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(s);
}
