import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope.js";
import { supabaseAdmin } from "../lib/supabase.js";

export const espressoRouter = new Hono();

const lsh = () => (supabaseAdmin as any).schema("lsh");

// Fetch NYC weather from OpenMeteo (free, no key)
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
    const description = descriptions[code] ?? "Clear";
    return { temp: Math.round(cw?.temperature ?? 72), weathercode: code, description };
  } catch { return null; }
}

// Fetch business/fashion news via RSS2JSON
async function fetchNews(): Promise<Array<{ title: string; link: string; pubDate: string }>> {
  try {
    const feeds = [
      "https://www.businessoffashion.com/feed/",
      "https://feeds.bloomberg.com/markets/news.rss",
    ];
    const feedUrl = encodeURIComponent(feeds[0]!);
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
  const todayStr = now.toISOString().split("T")[0];
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split("T")[0];

  if (!supabaseAdmin) return c.json({ data: null });

  // Run all DB queries in parallel
  const [
    briefRes,
    appointmentsRes,
    approvalsRes,
    urgentApprovalsRes,
    tasksRes,
    revenueRes,
    arRes,
    draftInvoicesRes,
    weatherData,
    newsData,
  ] = await Promise.all([
    // Latest Maestro brief
    lsh()
      .from("agent_briefs")
      .select("title, body, created_at")
      .eq("source", "maestro")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),

    // Today + tomorrow appointments
    supabaseAdmin
      .from("appointments")
      .select("event_type, start_time, end_time, status")
      .gte("start_time", `${todayStr}T00:00:00Z`)
      .lte("start_time", `${tomorrowStr}T23:59:59Z`)
      .order("start_time"),

    // Pending approval count
    supabaseAdmin
      .from("approval_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),

    // Urgent approvals
    supabaseAdmin
      .from("approval_queue")
      .select("id, title, category, priority, created_at")
      .eq("status", "pending")
      .in("priority", ["urgent", "high"])
      .order("created_at")
      .limit(5),

    // Open agent tasks
    lsh()
      .from("agent_tasks")
      .select("id, title, status, priority, due_at")
      .in("status", ["pending", "active"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(8),

    // Revenue today + 7d
    (async () => { try { return await supabaseAdmin.rpc("get_revenue_summary").maybeSingle(); } catch { return { data: null }; } })(),

    // AR outstanding
    supabaseAdmin
      .from("erp_sales_invoices")
      .select("outstanding_amount")
      .in("status", ["Unpaid", "Overdue", "Partly Paid"]),

    // Draft invoices count
    supabaseAdmin
      .from("erp_sales_invoices")
      .select("id", { count: "exact", head: true })
      .eq("status", "Draft"),

    // Weather + news in parallel
    fetchWeather(),
    fetchNews(),
  ]);

  // Revenue: fallback to raw square_payments if RPC doesn't exist
  let revenueToday = 0;
  let revenue7d = 0;
  if (!revenueRes.data) {
    const [todayRes, weekRes] = await Promise.all([
      supabaseAdmin.from("square_payments").select("total_cents").eq("status", "COMPLETED").gte("created_at", `${todayStr}T00:00:00Z`),
      supabaseAdmin.from("square_payments").select("total_cents").eq("status", "COMPLETED").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);
    revenueToday = (todayRes.data ?? []).reduce((s: number, r: any) => s + (r.total_cents ?? 0), 0) / 100;
    revenue7d = (weekRes.data ?? []).reduce((s: number, r: any) => s + (r.total_cents ?? 0), 0) / 100;
  }

  const arTotal = (arRes.data ?? []).reduce((s: number, r: any) => s + (r.outstanding_amount ?? 0), 0);

  // Deduplicate appointments by event_type+start_time
  const seen = new Set<string>();
  const appointments = (appointmentsRes.data ?? []).filter((a: any) => {
    const key = `${a.event_type}|${a.start_time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const today = appointments.filter((a: any) => a.start_time?.startsWith(todayStr));
  const tomorrow = appointments.filter((a: any) => !a.start_time?.startsWith(todayStr));

  return c.json({
    data: {
      brief: briefRes.data ?? null,
      appointments: { today, tomorrow },
      approvals: {
        total: approvalsRes.count ?? 0,
        urgent: urgentApprovalsRes.data ?? [],
      },
      tasks: tasksRes.data ?? [],
      revenue: {
        today: revenueToday,
        sevenDay: revenue7d,
        ar: arTotal,
        draftInvoices: draftInvoicesRes.count ?? 0,
      },
      weather: weatherData,
      news: newsData,
      generatedAt: now.toISOString(),
    },
  });
});
