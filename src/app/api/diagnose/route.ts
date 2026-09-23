import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// TEMPORARY DIAGNOSTIC — safe to delete afterwards. Dumps the actual
// contents of the financial tables so we can see whether the data is
// present but in an unexpected shape (e.g. attached to a different
// employee id, or in old columns the new code no longer reads).
export async function GET(req: NextRequest) {
  const out: Record<string, unknown> = {};

  const dump = async (table: string) => {
    const { data, error } = await supabaseAdmin.from(table).select("*").limit(50);
    return error ? `ERROR: ${error.message}` : data;
  };

  out.staff_ids = await (async () => {
    const { data, error } = await supabaseAdmin
      .from("staff").select("id, name, pv_bonus_eligible, ho_bonus_eligible, archived");
    return error ? `ERROR: ${error.message}` : data;
  })();

  out.pv_bonus_quarters = await dump("pv_bonus_quarters");
  out.pv_bonus_payroll_entries = await dump("pv_bonus_payroll_entries");
  out.pv_bonus_payments = await dump("pv_bonus_payments");
  out.weekly_cash_reviews = await dump("weekly_cash_reviews");
  out.ho_bonus_months = await dump("ho_bonus_months");
  out.cash_accounts = await dump("cash_accounts");

  return NextResponse.json(out);
}
