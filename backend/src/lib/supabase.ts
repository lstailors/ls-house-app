import { createClient } from "@supabase/supabase-js";

function makeAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Public-schema service-role client (default PostgREST schema).
export const supabaseAdmin = makeAdminClient();

// lsh-schema service-role client. Use for all lsh.* tables.
// Cast required because the JS client's .schema() typing is narrow.
export const lshAdmin: ReturnType<typeof makeAdminClient> = supabaseAdmin
  ? (supabaseAdmin as any).schema("lsh") as ReturnType<typeof makeAdminClient>
  : null;
