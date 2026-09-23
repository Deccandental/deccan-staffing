import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken } from "@/lib/session";

// TEMPORARY DIAGNOSTIC — safe to delete once the data-loading issue is
// resolved. Reports environment-variable presence, table row counts, and
// (when called with a token) whether that specific token verifies.
// Reports only presence/length of secrets, never their values.
export async function GET(req: NextRequest) {
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

  // If the browser sent its stored session token, report whether it
  // verifies here. This distinguishes "no token stored" from "token stored
  // but rejected", which are very different problems.
  const token = req.headers.get("x-session-token");
  let tokenCheck: string;
  if (!token) {
    tokenCheck = "no token sent with this request";
  } else {
    const session = verifySessionToken(token);
    tokenCheck = session
      ? `VALID - mode=${session.mode}, canManagePayroll=${session.canManagePayroll}, employeeId=${session.employeeId ?? "n/a"}`
      : "INVALID - token present but failed verification";
  }

  // Also exercise the exact query shape the app uses, through the same
  // service-role client the secure-data route uses.
  let sampleQuery: string;
  try {
    const { data, error } = await supabaseAdmin
      .from("pv_bonus_quarters").select("*").order("year").order("quarter");
    sampleQuery = error ? `ERROR: ${error.message}` : `returned ${data?.length ?? 0} rows`;
  } catch (err: any) {
    sampleQuery = `EXCEPTION: ${err?.message ?? "unknown"}`;
  }

  return NextResponse.json({ env, tables: results, tokenCheck, sampleQuery });
}
