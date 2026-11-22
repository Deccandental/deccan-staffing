// Server-only Supabase client, using the service role key rather than the
// public anon key. This client bypasses Row-Level Security entirely, so it
// must ONLY ever be imported from API routes (files under src/app/api/) —
// never from a "use client" component, and never re-exported to the browser.
//
// This exists specifically so that sensitive lookups (verifying a PIN
// against the staff table, for example) can happen without ever shipping
// the underlying data — or the service role key itself — to the browser.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  // Fails loudly at request time rather than silently falling back to the
  // anon key, which would defeat the entire point of this client.
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Server-side routes that need " +
    "privileged database access (e.g. PIN verification) will fail until " +
    "this environment variable is added."
  );
}

// A placeholder (never a real key) keeps the module loadable when the key is
// missing — e.g. during `next build` in an environment that doesn't have it —
// instead of crashing the whole build. Requests then fail with an auth error.
export const supabaseAdmin = createClient(supabaseUrl || "http://supabase-url-not-set.invalid", serviceRoleKey || "service-role-key-not-set", {
  auth: { autoRefreshToken: false, persistSession: false },
});
