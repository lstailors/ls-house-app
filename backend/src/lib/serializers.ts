// Convert Prisma records (Date objects, JSON strings) into API-shaped responses.

export function parseJson(s: string | null, fallback: any = {}) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function serializeProfile(u: any) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    locationId: u.locationId,
    location: u.location ? serializeLocation(u.location) : undefined,
    image: u.image,
    isActive: u.isActive,
  };
}

export function serializeLocation(l: any) {
  if (!l) return null;
  return {
    id: l.id,
    name: l.name,
    address: l.address,
    erpnextCompanyOrBranch: l.erpnextCompanyOrBranch,
    isActive: l.isActive,
    createdAt: l.createdAt?.toISOString?.() ?? l.createdAt,
    updatedAt: l.updatedAt?.toISOString?.() ?? l.updatedAt,
  };
}

export function serializeCustomer(c: any) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    locationId: c.locationId,
    createdById: c.createdById,
    dossier: parseJson(c.dossierJson, {}),
    createdAt: c.createdAt?.toISOString?.() ?? c.createdAt,
    updatedAt: c.updatedAt?.toISOString?.() ?? c.updatedAt,
  };
}

export function serializeTailor(t: any) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    locationId: t.locationId,
    isActive: t.isActive,
    createdAt: t.createdAt?.toISOString?.() ?? t.createdAt,
    location: t.location ? serializeLocation(t.location) : undefined,
  };
}

export function serializeAlteration(a: any) {
  if (!a) return null;
  return {
    id: a.id,
    customerId: a.customerId,
    customer: a.customer ? serializeCustomer(a.customer) : undefined,
    locationId: a.locationId,
    items: parseJson(a.itemsJson, []),
    price: a.price,
    status: a.status,
    tailorId: a.tailorId,
    tailor: a.tailor ? serializeTailor(a.tailor) : null,
    dueDate: a.dueDate?.toISOString?.() ?? a.dueDate,
    notes: a.notes,
    createdById: a.createdById,
    createdBy: a.createdBy ? serializeProfile(a.createdBy) : undefined,
    createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
    updatedAt: a.updatedAt?.toISOString?.() ?? a.updatedAt,
  };
}

export function serializeCustomOrder(o: any) {
  if (!o) return null;
  return {
    id: o.id,
    customerId: o.customerId,
    customer: o.customer ? serializeCustomer(o.customer) : undefined,
    locationId: o.locationId,
    garmentType: o.garmentType,
    quotedPrice: o.quotedPrice,
    priceTbd: o.priceTbd,
    depositAmount: o.depositAmount,
    status: o.status,
    notes: o.notes,
    spec: parseJson(o.specJson, {}),
    createdById: o.createdById,
    createdBy: o.createdBy ? serializeProfile(o.createdBy) : undefined,
    createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
    updatedAt: o.updatedAt?.toISOString?.() ?? o.updatedAt,
  };
}

export function serializeSalesOrder(s: any) {
  if (!s) return null;
  return {
    id: s.id,
    customOrderId: s.customOrderId,
    locationId: s.locationId,
    erpnextId: s.erpnextId,
    status: s.status,
    total: s.total,
    payload: parseJson(s.payloadJson, {}),
    createdAt: s.createdAt?.toISOString?.() ?? s.createdAt,
    customer: s.customOrder?.customer ? serializeCustomer(s.customOrder.customer) : null,
  };
}

export function serializeInvoice(i: any) {
  if (!i) return null;
  return {
    id: i.id,
    salesOrderId: i.salesOrderId,
    locationId: i.locationId,
    erpnextId: i.erpnextId,
    status: i.status,
    total: i.total,
    pdfUrl: i.pdfUrl,
    createdAt: i.createdAt?.toISOString?.() ?? i.createdAt,
    customer: i.salesOrder?.customOrder?.customer
      ? serializeCustomer(i.salesOrder.customOrder.customer)
      : null,
  };
}

export function serializeDelivery(d: any) {
  if (!d) return null;
  return {
    id: d.id,
    orderRef: d.orderRef,
    customOrderId: d.customOrderId,
    customerId: d.customerId,
    customer: d.customer ? serializeCustomer(d.customer) : undefined,
    locationId: d.locationId,
    driverId: d.driverId,
    driver: d.driver ? serializeProfile(d.driver) : null,
    status: d.status,
    proofOfDeliveryUrl: d.proofOfDeliveryUrl,
    scheduledAt: d.scheduledAt?.toISOString?.() ?? d.scheduledAt,
    deliveredAt: d.deliveredAt?.toISOString?.() ?? d.deliveredAt,
    addressLine: d.addressLine,
    notes: d.notes,
    erpnextSynced: d.erpnextSynced,
    createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
  };
}

export function serializeCommunication(c: any) {
  if (!c) return null;
  return {
    id: c.id,
    customerId: c.customerId,
    customer: c.customer ? serializeCustomer(c.customer) : undefined,
    locationId: c.locationId,
    channel: c.channel,
    direction: c.direction,
    transcript: c.transcript,
    body: c.body,
    createdAt: c.createdAt?.toISOString?.() ?? c.createdAt,
  };
}
