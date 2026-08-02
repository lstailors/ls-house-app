import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import {
  listAgentBriefsFiltered,
  listApprovalQueue,
  listAgentTasks,
} from "../lib/erpnext/agents";

export const espressoRouter = new Hono();

async function fetchWeather(): Promise<{ temp: number; weathercode: number; description: string } | null> {
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current_weather=true&temperature_unit=fahrenheit&wind_speed_unit=mph",
      { cf: { cacheTtl: 1800 } } as any
    );
    const data: any = await res.json();
    const cw = data.current_weather;
    const code = cw?.weathercode ?? 0;
    const descriptions: Record<number, string> = {
      0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
      45: "Foggy", 48: "Foggy", 51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
      61: "Light Rain", 63: "Rain", 65: "Heavy Rain", 71: "Light Snow", 73: "Snow", 75: "Heavy Snow",
      80: "Showers", 81: "Showers", 82: "Heavy Showers", 95: "Thunderstorm", 99: "Thunderstorm",
    };
    return { temp: Math.round(cw?.temperature ?? 72), weathercode: code, description: descriptions[code] ?? "Clear" };
  } catch { return null; }
}

async function fetchNews(): Promise<Array<{ title: string; link: string; pubDate: string }>> {
  try {
    const feedUrl = encodeURIComponent("https://www.businessoffashion.com/feed/");
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${feedUrl}&count=5`);
    const data: any = await res.json();
    return (data.items ?? []).slice(0, 5).map((item: any) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
    }));
  } catch { return []; }
}

espressoRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0]!;
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split("T")[0]!;

  const [
    briefRows,
    appointments,
    pendingApprovals,
    urgentApprovals,
    tasks,
    paidTodayInvoices,
    arInvoices,
    draftInvoices,
    weatherData,
    newsData,
  ] = await Promise.all([
    listAgentBriefsFiltered({ source: "maestro", type: "daily_brief", limit: 1 }),
    // Live ERP: Event (GCal L&S Appointments) + CRM Appointment.
    // LSH Appointment doctype does not exist on the live site.
    Promise.all([
      erpList<any>("Event", {
        filters: [
          ["starts_on", ">=", `${todayStr} 00:00:00`],
          ["starts_on", "<=", `${tomorrowStr} 23:59:59`],
          ["status", "!=", "Cancelled"],
          ["google_calendar", "like", "%Appointment%"],
        ],
        fields: ["name", "subject", "starts_on", "ends_on", "status", "google_calendar"],
        limit: 50,
        order_by: "starts_on asc",
      }).catch(() => []),
      erpList<any>("Appointment", {
        filters: [
          ["scheduled_time", ">=", `${todayStr} 00:00:00`],
          ["scheduled_time", "<=", `${tomorrowStr} 23:59:59`],
          ["status", "not in", ["Closed", "Cancelled"]],
        ],
        fields: ["name", "scheduled_time", "status", "customer_name", "custom_appointment_type"],
        limit: 50,
        order_by: "scheduled_time asc",
      }).catch(() => []),
    ]).then(([evts, apmts]) => {
      const mapped: any[] = [];
      for (const e of evts) {
        mapped.push({
          name: e.name,
          event_type: e.subject,
          start_time: String(e.starts_on ?? "").replace(" ", "T"),
          end_time: e.ends_on ? String(e.ends_on).replace(" ", "T") : null,
          status: e.status,
        });
      }
      for (const a of apmts) {
        mapped.push({
          name: a.name,
          event_type: a.custom_appointment_type || a.customer_name || "Appointment",
          start_time: String(a.scheduled_time ?? "").replace(" ", "T"),
          end_time: null,
          status: a.status,
          customer_name: a.customer_name,
        });
      }
      mapped.sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)));
      return mapped;
    }),
    listApprovalQueue({ status: ["pending"], limit: 200 }),
    listApprovalQueue({ status: ["pending"], limit: 5 }),
    listAgentTasks({ status: ["pending", "active", "in_progress"], limit: 8 }),
    erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", "=", todayStr], ["status", "=", "Paid"]],
      fields: ["name", "grand_total"],
      limit: 500,
    }).catch(() => []),
    erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["outstanding_amount", ">", 0]],
      fields: ["name", "outstanding_amount"],
      limit: 500,
    }).catch(() => []),
    erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 0]],
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
    fetchWeather(),
    fetchNews(),
  ]);

  const briefRow = briefRows[0];
  const briefRes = briefRow ? { title: briefRow.title, body: briefRow.body, created_at: briefRow.creation } : null;

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]!;
  const paidWeekInvoices = await erpList<any>("Sales Invoice", {
    filters: [["docstatus", "=", 1], ["status", "=", "Paid"], ["posting_date", ">=", weekAgo]],
    fields: ["name", "grand_total"],
    limit: 500,
  }).catch(() => []);

  const revenueToday = paidTodayInvoices.reduce((s: number, r: any) => s + Number(r.grand_total ?? 0), 0);
  const revenue7d = paidWeekInvoices.reduce((s: number, r: any) => s + Number(r.grand_total ?? 0), 0);
  const arTotal = arInvoices.reduce((s: number, r: any) => s + Number(r.outstanding_amount ?? 0), 0);

  const seen = new Set<string>();
  const apptList = appointments.filter((a: any) => {
    const key = `${a.event_type}|${a.start_time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const today = apptList.filter((a: any) => a.start_time?.startsWith(todayStr));
  const tomorrow = apptList.filter((a: any) => !a.start_time?.startsWith(todayStr));

  const urgent = urgentApprovals.filter((a: any) => ["urgent", "high"].includes(a.priority));

  return c.json({
    data: {
      brief: briefRes,
      appointments: { today, tomorrow },
      approvals: {
        total: pendingApprovals.length,
        urgent: urgent.map((a: any) => ({ id: a.name, title: a.title, category: a.category, priority: a.priority, created_at: a.creation })),
      },
      tasks: tasks.map((t: any) => ({ id: t.name, title: t.title, status: t.status, priority: t.priority, due_at: t.due_at })),
      revenue: {
        today: revenueToday,
        sevenDay: revenue7d,
        ar: arTotal,
        draftInvoices: draftInvoices.length,
      },
      weather: weatherData,
      news: newsData,
      generatedAt: now.toISOString(),
    },
  });
});
