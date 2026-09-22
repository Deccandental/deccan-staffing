import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Centralizes what used to be six separate client-side comparisons against
// a full list of staff PINs (and a hardcoded master passcode) shipped to
// every browser. Now the actual PIN values and the master passcode never
// leave the server — only the safe identity fields of whichever employee
// matched (never their PIN) are returned, plus whether the entered code was
// the master passcode. Each gate component keeps its own logic for what a
// match means for that page (e.g. "does this employee have canManageLeave"),
// since that logic isn't itself sensitive.
export async function POST(req: NextRequest) {
  const { code } = await req.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json({ ok: false });
  }

  const isSuper = !!process.env.SUPER_PASSCODE && code === process.env.SUPER_PASSCODE;

  const { data, error } = await supabaseAdmin
    .from("staff")
    .select(
      "id, name, email, can_admin, can_manage_leave, can_manage_events, can_manage_certs, can_manage_payroll, exempt_from_policy_signing, exempt_from_checkin, archived, pin"
    )
    .eq("pin", code)
    .eq("archived", false)
    .maybeSingle();

  if (error) {
    console.error("auth/login lookup error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!isSuper && !data) {
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({
    ok: true,
    isSuper,
    employee: data
      ? {
          id: data.id,
          name: data.name,
          email: data.email ?? "",
          canAdmin: !!data.can_admin,
          canManageLeave: !!data.can_manage_leave,
          canManageEvents: !!data.can_manage_events,
          canManageCerts: !!data.can_manage_certs,
          canManagePayroll: !!data.can_manage_payroll,
          exemptFromPolicySigning: !!data.exempt_from_policy_signing,
          exemptFromCheckin: !!data.exempt_from_checkin,
        }
      : null,
  });
}
