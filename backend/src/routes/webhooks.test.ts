import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const matchCustomerByPhone = mock(async (_phone: string) => ({ id: "CUST-0001", name: "Ada Lovelace" }));
const logErpCommunication = mock(async (_opts: unknown) => undefined);
const insertCallLog = mock(async (_doc: unknown) => ({}));
const upsertCallLog = mock(async (_doc: unknown) => ({}));
const insertSmsMessage = mock(async (_doc: unknown) => ({}));

mock.module("./comms", () => ({ matchCustomerByPhone, logErpCommunication }));
mock.module("../lib/erpnext/agents", () => ({ insertCallLog, upsertCallLog, insertSmsMessage }));
mock.module("../lib/docuseal", () => ({ parseDocusealWebhook: () => ({ completed: false, ids: [] }) }));
mock.module("./qc", () => ({
  attachDocusealResultFiles: async () => undefined,
  markQcSignedBySubmission: async () => null,
}));

let webhooksRouter: typeof import("./webhooks").webhooksRouter;
const originalFetch = globalThis.fetch;
const originalEnv = {
  UNIFI_WEBHOOK_SECRET: process.env.UNIFI_WEBHOOK_SECRET,
  N8N_COMMS_WEBHOOK_URL: process.env.N8N_COMMS_WEBHOOK_URL,
  N8N_COMMS_WEBHOOK_SECRET: process.env.N8N_COMMS_WEBHOOK_SECRET,
};

beforeAll(async () => {
  ({ webhooksRouter } = await import("./webhooks"));
});

beforeEach(() => {
  process.env.UNIFI_WEBHOOK_SECRET = "unifi-test-secret";
  process.env.N8N_COMMS_WEBHOOK_URL = "https://n8n.example.test/webhook/comms";
  process.env.N8N_COMMS_WEBHOOK_SECRET = "n8n-test-secret";
  matchCustomerByPhone.mockClear();
  logErpCommunication.mockClear();
  insertCallLog.mockClear();
  upsertCallLog.mockClear();
  insertSmsMessage.mockClear();
  globalThis.fetch = mock(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function postUnifi(type: string, body: Record<string, unknown>, token = "unifi-test-secret") {
  return webhooksRouter.request(`http://example.test/unifi?type=${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Token": token,
    },
    body: JSON.stringify(body),
  });
}

function payloadFixture(type: string): Promise<Record<string, unknown>> {
  return Bun.file(new URL(`../../../docs/unifi-payloads/${type}.json`, import.meta.url)).json();
}

describe("POST /unifi n8n forwarding", () => {
  test("forwards a normalized transcript with the shared secret after storage", async () => {
    const forwarded: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push({ url: String(input), init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const response = await webhooksRouter.request("http://example.test/unifi?type=transcript", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Token": "unifi-test-secret",
      },
      body: JSON.stringify({
        call_id: "call-123",
        from: "+121****0123",
        from_name: "Ada Lovelace",
        summary: "Requested a fitting appointment",
        transcript: "I would like to book a fitting.",
        recording_url: "https://talk.example.test/recordings/call-123",
        duration: 42,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(upsertCallLog).toHaveBeenCalledTimes(1);
    expect(upsertCallLog).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: "call-123",
        status: "accepted",
        customer: "CUST-0001",
      }),
    );
    expect(logErpCommunication).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.url).toBe("https://n8n.example.test/webhook/comms");
    expect(forwarded[0]?.init?.method).toBe("POST");
    expect(forwarded[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Webhook-Token": "n8n-test-secret",
    });

    const payload = JSON.parse(String(forwarded[0]?.init?.body));
    expect(payload).toMatchObject({
      source: "unifi_talk",
      type: "transcript",
      call_id: "call-123",
      caller_phone: "+121****0123",
      caller_name: "Ada Lovelace",
      customer: "CUST-0001",
      customer_name: "Ada Lovelace",
      summary: "Requested a fitting appointment",
      transcript: "I would like to book a fitting.",
      recording_url: "https://talk.example.test/recordings/call-123",
      duration: 42,
    });
    expect(new Date(payload.occurred_at).toISOString()).toBe(payload.occurred_at);
  });

  test("stores emergency calls with emergency status", async () => {
    const response = await postUnifi("emergency", { call_id: "emergency-123", from: "+121****0199" });

    expect(response.status).toBe(200);
    expect(upsertCallLog).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: "emergency-123", status: "emergency" }),
    );
  });

  test("uses one customer match and one forward path for SMS", async () => {
    const forwarded: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push({ url: String(input), init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const response = await postUnifi("sms", {
      id: "sms-123",
      from: "+121****0123",
      from_name: "Ada Lovelace",
      message: "Can I move tomorrow's fitting?",
    });

    expect(response.status).toBe(200);
    expect(matchCustomerByPhone).toHaveBeenCalledTimes(1);
    expect(matchCustomerByPhone).toHaveBeenCalledWith("+121****0123");
    expect(insertSmsMessage).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveLength(1);
    expect(JSON.parse(String(forwarded[0]?.init?.body))).toMatchObject({
      source: "unifi_talk",
      type: "sms",
      call_id: "sms-123",
      caller_phone: "+121****0123",
      customer: "CUST-0001",
      customer_name: "Ada Lovelace",
    });
  });

  test("forwards every supported event type through the same path", async () => {
    const forwardedTypes: string[] = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedTypes.push(JSON.parse(String(init?.body)).type);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    for (const type of ["transcript", "voicemail", "missed", "failed", "sms", "emergency"]) {
      await postUnifi(type, await payloadFixture(type));
    }

    expect(forwardedTypes).toEqual(["transcript", "voicemail", "missed", "failed", "sms", "emergency"]);
  });

  test("silently skips forwarding when the n8n URL is unset", async () => {
    delete process.env.N8N_COMMS_WEBHOOK_URL;
    const forward = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = forward as unknown as typeof fetch;

    const response = await postUnifi("missed", { call_id: "missed-123", from: "+121****0123" });

    expect(response.status).toBe(200);
    expect(forward).not.toHaveBeenCalled();
  });

  test("rejects a bogus UniFi token before storage or forwarding", async () => {
    const forward = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = forward as unknown as typeof fetch;

    const response = await postUnifi(
      "transcript",
      { call_id: "blocked-123", from: "+121****0123" },
      "bogus-token",
    );

    expect(response.status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
    expect(matchCustomerByPhone).not.toHaveBeenCalled();
    expect(upsertCallLog).not.toHaveBeenCalled();
    expect(insertCallLog).not.toHaveBeenCalled();
    expect(insertSmsMessage).not.toHaveBeenCalled();
  });

  test("still returns 200 when n8n hangs past the forward timeout", async () => {
    const forward = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    globalThis.fetch = forward as unknown as typeof fetch;

    const started = Date.now();
    const response = await postUnifi("voicemail", { call_id: "voicemail-123", from: "+121****0123" });
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThan(2000);
    expect(elapsed).toBeLessThan(4000);
  });

  test("keeps the UniFi response successful when n8n rejects", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("n8n unavailable"))) as unknown as typeof fetch;
    const warn = console.warn;
    console.warn = mock(() => undefined);

    try {
      const response = await postUnifi("failed", { call_id: "failed-123", from: "+121****0123" });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      console.warn = warn;
    }
  });
});
