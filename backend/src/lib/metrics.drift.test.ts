import { describe, expect, test } from "bun:test";
import { erpCount } from "./erp";
import { getAltsMetrics, metricFilters } from "./metrics";

const live = Boolean(process.env.ERPNEXT_BASE_URL && process.env.ERPNEXT_API_KEY);

describe("metrics drift vs independent ERPNext COUNTs", () => {
  test.skipIf(!live)("getAltsMetrics matches re-COUNTed METRIC_FILTERS", async () => {
    const metrics = await getAltsMetrics();
    const f = metricFilters(metrics.today);

    const [
      openAlts,
      tasksOpen,
      tasksOverdue,
      hd,
      queued,
      out,
      deliveredToday,
      texts,
      calls,
      voice,
      fittings,
    ] = await Promise.all([
      erpCount("Alteration Ticket", f.openAlterations),
      erpCount("ToDo", f.tasksOpen),
      erpCount("ToDo", f.tasksOverdue),
      erpCount("HD Ticket", f.hdOpen),
      erpCount("LSH Delivery", f.deliveriesQueued),
      erpCount("LSH Delivery", f.deliveriesOut),
      erpCount("LSH Delivery", f.deliveriesDeliveredToday),
      erpCount("LSH SMS Message", f.messagesTexts),
      erpCount("LSH Call Log", f.messagesCalls),
      erpCount("LSH Plaud Capture", f.messagesVoice),
      erpCount("Appointment", f.messagesFittings),
    ]);

    const drift: string[] = [];
    const check = (label: string, a: number, b: number) => {
      if (a !== b) drift.push(`${label}: metrics=${a} independent=${b}`);
    };
    check("open_alterations", metrics.open_alterations, openAlts);
    check("tasks.open", metrics.tasks.open, tasksOpen);
    check("tasks.overdue", metrics.tasks.overdue, tasksOverdue);
    check("hd_tickets_open", metrics.hd_tickets_open, hd);
    check("deliveries.queued", metrics.deliveries.queued, queued);
    check("deliveries.out", metrics.deliveries.out, out);
    check("deliveries.delivered_today", metrics.deliveries.delivered_today, deliveredToday);
    check("messages.texts", metrics.messages.texts, texts);
    check("messages.calls", metrics.messages.calls, calls);
    check("messages.voice", metrics.messages.voice, voice);
    check("messages.fittings", metrics.messages.fittings, fittings);
    check(
      "messages.all",
      metrics.messages.all,
      metrics.messages.texts +
        metrics.messages.calls +
        metrics.messages.voice +
        metrics.messages.fittings +
        metrics.messages.other,
    );

    expect(drift).toEqual([]);
  });
});
