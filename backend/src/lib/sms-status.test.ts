import { describe, expect, test } from "bun:test";
import { applyTwilioMessageStatus, isDeliverableSid } from "./sms-status";

describe("applyTwilioMessageStatus", () => {
  test("queued is accepted, not delivered", () => {
    const patch = applyTwilioMessageStatus({}, { messageStatus: "queued" });
    expect(patch).toEqual({
      status: "sent",
      delivery_status: "queued",
      error_message: "",
    });
  });

  test("delivered advances a queued receipt", () => {
    const patch = applyTwilioMessageStatus(
      { status: "sent", delivery_status: "queued" },
      { messageStatus: "delivered" },
    );
    expect(patch?.status).toBe("sent");
    expect(patch?.delivery_status).toBe("delivered");
  });

  test("a late queued callback does not wipe delivered", () => {
    expect(
      applyTwilioMessageStatus(
        { status: "sent", delivery_status: "delivered" },
        { messageStatus: "queued" },
      ),
    ).toBeNull();
  });

  test("undelivered marks the row failed and keeps the carrier error", () => {
    const patch = applyTwilioMessageStatus(
      { status: "sent", delivery_status: "sent" },
      { messageStatus: "undelivered", errorCode: "30008", errorMessage: "Unknown error" },
    );
    expect(patch).toEqual({
      status: "failed",
      delivery_status: "undelivered",
      error_message: "30008: Unknown error",
    });
  });

  test("delivered does not un-fail a message", () => {
    expect(
      applyTwilioMessageStatus(
        { status: "failed", delivery_status: "failed" },
        { messageStatus: "delivered" },
      ),
    ).toBeNull();
  });

  test("unknown statuses are ignored", () => {
    expect(applyTwilioMessageStatus({ status: "sent" }, { messageStatus: "read" })).toBeNull();
  });

  test("a row logged only as sent still accepts a failure receipt", () => {
    const patch = applyTwilioMessageStatus({ status: "sent" }, { messageStatus: "failed" });
    expect(patch?.status).toBe("failed");
    expect(patch?.delivery_status).toBe("failed");
  });
});

describe("isDeliverableSid", () => {
  test("held ids are not delivery proof", () => {
    expect(isDeliverableSid("held_171000")).toBe(false);
    expect(isDeliverableSid("")).toBe(false);
    expect(isDeliverableSid(null)).toBe(false);
    expect(isDeliverableSid("SM123")).toBe(true);
  });
});
