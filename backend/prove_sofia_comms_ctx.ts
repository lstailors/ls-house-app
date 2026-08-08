/**
 * Prove D1 inject pieces without calling Grok:
 * getCommsEvents for a known phone returns events Sofia would see.
 */
import { getCommsEvents } from "./src/lib/comms-events";

const phone = process.argv[2] || "+16319260917";

const feed = await getCommsEvents({
  phone,
  source: "all",
  limit: 15,
  role: "super_admin",
});

const lines = (feed.events || []).slice(0, 10).map((ev) => {
  const when = ev.occurred_at || "?";
  return `[${ev.source_type}] ${when}: ${(ev.summary || "").slice(0, 80)}`;
});

console.log(
  JSON.stringify(
    {
      customer: feed.customer,
      counts: feed.counts,
      n: feed.events.length,
      sample: lines,
      would_inject: feed.events.length > 0,
    },
    null,
    2,
  ),
);
console.log(feed.events.length > 0 ? "D1_PROVE_OK" : "D1_PROVE_EMPTY");
