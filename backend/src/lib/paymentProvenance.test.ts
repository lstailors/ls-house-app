import { describe, expect, test } from "bun:test";
import { recordCardOnFileProvenance } from "./paymentProvenance";

describe("recordCardOnFileProvenance", () => {
  test("writes the Square payment id and Card on File method to the ticket", async () => {
    const calls: unknown[][] = [];
    const update = async (...args: unknown[]) => {
      calls.push(args);
      return { name: "ALT-NYC-2026-00001" };
    };

    await recordCardOnFileProvenance(
      { ticket: "ALT-NYC-2026-00001", paymentId: "sq-pay-123" },
      update,
    );

    expect(calls).toEqual([
      [
        "Alteration Ticket",
        "ALT-NYC-2026-00001",
        {
          square_transaction_id: "sq-pay-123",
          square_payment_method: "Card on File",
        },
      ],
    ]);
  });

  test("propagates ERP failures instead of reporting a false success", async () => {
    const update = async () => {
      throw new Error("ERP schema rejected Card on File");
    };

    await expect(
      recordCardOnFileProvenance(
        { ticket: "ALT-NYC-2026-00001", paymentId: "sq-pay-123" },
        update,
      ),
    ).rejects.toThrow("ERP schema rejected Card on File");
  });

  test("rejects an empty ERP response instead of assuming provenance was saved", async () => {
    const update = async () => null;

    await expect(
      recordCardOnFileProvenance(
        { ticket: "ALT-NYC-2026-00001", paymentId: "sq-pay-123" },
        update,
      ),
    ).rejects.toThrow("ERP did not confirm the ticket provenance update");
  });
});
