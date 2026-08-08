/**
 * Prove Phase 1 getCommsEvents against live ERP (no HTTP auth needed).
 * Run: cd backend && bun run /tmp/prove_comms_events.ts
 */
import { getCommsEvents } from "./src/lib/comms-events";

const customer = process.argv[2] || "Stewart Rothenberg";
const phone = process.argv[3] || "+19172087474";

async function main() {
  console.log("=== by customer", customer);
  const a = await getCommsEvents({
    customer,
    source: "all",
    limit: 30,
    role: "super_admin",
  });
  console.log(
    JSON.stringify(
      {
        customer: a.customer,
        counts: a.counts,
        sources: a.sources,
        sensitive_redacted: a.sensitive_redacted,
        sample: a.events.slice(0, 8).map((e) => ({
          id: e.id,
          source_type: e.source_type,
          occurred_at: e.occurred_at,
          summary: e.summary?.slice(0, 80),
          phone: e.phone,
        })),
      },
      null,
      2,
    ),
  );

  console.log("\n=== by phone", phone);
  const b = await getCommsEvents({
    phone,
    source: "all",
    limit: 20,
    role: "salesperson",
  });
  console.log(
    JSON.stringify(
      {
        customer: b.customer,
        counts: b.counts,
        sensitive_redacted: b.sensitive_redacted,
        n: b.events.length,
      },
      null,
      2,
    ),
  );

  const ok = a.counts.all > 0 || b.counts.all > 0;
  console.log(ok ? "\nPROVE_OK" : "\nPROVE_EMPTY");
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error("PROVE_FAIL", e);
  process.exit(1);
});
