import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// TEMPORARY DIAGNOSTIC — safe to delete once the data-loading issue is
// resolved. Reports whether the required environment variables are present
// and whether the service-role client can actually reach the database.
// Deliberately reports only presence/length, never any secret's value.
export async function GET() {
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `present (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`
      : "MISSING",
    SESSION_SECRET: process.env.SESSION_SECRET
      ? `present (${process.env.SESSION_SECRET.length} chars)`
      : "MISSING",
    SUPER_PASSCODE: process.env.SUPER_PASSCODE ? "present" : "MISSING",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? "present" : "MISSING",
  };

  // Try reading a couple of the financial tables with the service-role key.
  // If these come back with counts, the data is definitely still there and
  // the service key works — narrowing the problem to the session/token layer.
  const tables = ["pv_bonus_quarters", "weekly_cash_reviews", "payroll_entries", "ho_bonus_months"];
  const results: Record<string, string> = {};
  for (const t of tables) {
    try {
      const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      results[t] = error ? `ERROR: ${error.message}` : `${count ?? 0} rows`;
    } catch (err: any) {
      results[t] = `EXCEPTION: ${err?.message ?? "unknown"}`;
    }
  }

  return NextResponse.json({ env, tables: results });
}
