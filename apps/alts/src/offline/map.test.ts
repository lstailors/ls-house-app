import { describe, expect, test } from "bun:test";
import { appointmentToUi, customerToList, inDayRange, invoiceToUi, matchesCustomer } from "./map";

describe("offline snapshot mappers", () => {
  test("maps an ERP invoice header to the pickup/invoice row", () => {
    const row = invoiceToUi({
      name: "SINV-1",
      customer_name: "Jane",
      outstanding_amount: 40,
      grand_total: 40,
      status: "Unpaid",
    });
    expect(row.id).toBe("SINV-1");
    expect(row.customerName).toBe("Jane");
    expect(row.outstandingAmount).toBe(40);
  });

  test("maps a slim customer and matches search", () => {
    const row = { name: "CUST-1", customer_name: "Jane Peyser", mobile_no: "2125550100" };
    expect(customerToList(row).name).toBe("Jane Peyser");
    expect(matchesCustomer(row, "peyser")).toBe(true);
    expect(matchesCustomer(row, "5550100")).toBe(true);
    expect(matchesCustomer(row, "zzz")).toBe(false);
  });

  test("maps an appointment and keeps it in the shop week", () => {
    const appt = appointmentToUi({
      name: "APPT-1",
      scheduled_time: "2026-08-15 14:30:00",
      customer_name: "Jane Peyser",
      custom_appointment_type: "Fitting",
    });
    expect(appt.customerName).toBe("Jane Peyser");
    expect(appt.scheduledTime).toContain("2026-08-15");
    expect(inDayRange("2026-08-15 14:30:00", "2026-08-15", "2026-08-22")).toBe(true);
    expect(inDayRange("2026-08-10 09:00:00", "2026-08-15", "2026-08-22")).toBe(false);
  });
});
