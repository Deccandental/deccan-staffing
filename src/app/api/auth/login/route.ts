import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSessionToken } from "@/lib/session";

// Centralizes what used to be six separate client-side comparisons against
// a full list of staff PINs (and a hardcoded master passcode) shipped to
// every browser. Now the actual PIN values and the master passcode never
// leave the server — only the safe identity fields of whichever employee
// matched (never their PIN) are returned, plus whether the entered code was
// the master passcode. Each gate component keeps its own logic for what a
// match means for that page (e.g. "does this employee have canManageLeave"),
// since that logic isn't itself sensitive.
// Brute-force protection: after this many wrong codes from one address in
// the window, that address must wait. Attempts are kept in the database
// (login_attempts) because serverless instances don't share memory.
const MAX_FAILURES = 8;
const WINDOW_MINUTES = 15;

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}

async function tooManyFailures(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await supabaseAdmin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  // If the table isn't there yet, don't lock everyone out — just log it.
  if (error) { console.error("login_attempts check failed:", error.message); return false; }
  return (count ?? 0) >= MAX_FAILURES;
}

async function recordFailure(ip: string) {
  const { error } = await supabaseAdmin.from("login_attempts").insert({ ip });
  if (error) console.error("login_attempts insert failed:", error.message);
}

export async function POST(req: NextRequest) {
  let code: unknown;
  try { ({ code } = await req.json()); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  if (!code || typeof code !== "string" || code.length > 64) {
    return NextResponse.json({ ok: false });
  }

  const ip = clientIp(req);
  if (await tooManyFailures(ip)) {
    return NextResponse.json({ ok: false, locked: true, error: `Too many wrong attempts. Please wait ${WINDOW_MINUTES} minutes and try again.` }, { status: 429 });
  }

  const isSuper = !!process.env.SUPER_PASSCODE && code === process.env.SUPER_PASSCODE;

  // The CPA has their own passcode (CPA_PASSCODE, set on the server). It opens the statements page and
  // nothing else: the token carries no permissions, so the financial gateway and every admin route refuse it.
  const cpaCode = process.env.CPA_PASSCODE;
  if (!isSuper && cpaCode && cpaCode.length >= 8 && code === cpaCode) {
    const cpaToken = createSessionToken({
      mode: "cpa", employeeName: "CPA",
      canAdmin: false, canManageLeave: false, canManageEvents: false, canManageCerts: false, canManagePayroll: false, canManageStaffNotes: false,
    });
    return NextResponse.json({ ok: true, cpa: true, isSuper: false, employee: null, token: cpaToken });
  }

  const { data: matches, error } = await supabaseAdmin
    .from("staff")
    .select(
      "id, name, email, can_admin, can_manage_leave, can_manage_events, can_manage_certs, can_manage_payroll, can_manage_staff_notes, exempt_from_policy_signing, exempt_from_checkin, archived, pin"
    )
    .eq("pin", code)
    .eq("archived", false)
    .limit(2);

  if (error) {
    console.error("auth/login lookup error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  // Two people with the same PIN: refuse rather than guess who this is.
  if (!isSuper && matches && matches.length > 1) {
    return NextResponse.json({ ok: false, error: "This PIN is shared by more than one person. Please ask a manager to set you a new one." });
  }
  const data = matches?.[0] ?? null;

  if (!isSuper && !data) {
    await recordFailure(ip);
    return NextResponse.json({ ok: false });
  }

  const employee = data
    ? {
        id: data.id,
        name: data.name,
        email: data.email ?? "",
        canAdmin: !!data.can_admin,
        canManageLeave: !!data.can_manage_leave,
        canManageEvents: !!data.can_manage_events,
        canManageCerts: !!data.can_manage_certs,
        canManagePayroll: !!data.can_manage_payroll,
        canManageStaffNotes: !!data.can_manage_staff_notes,
        exemptFromPolicySigning: !!data.exempt_from_policy_signing,
        exemptFromCheckin: !!data.exempt_from_checkin,
      }
    : null;

  // The token is what later privileged requests present to prove this login
  // happened. Super sessions get every permission; staff sessions carry
  // exactly the flags on their own record.
  const token = createSessionToken(
    isSuper
      ? {
          mode: "super",
          canAdmin: true, canManageLeave: true, canManageEvents: true,
          canManageCerts: true, canManagePayroll: true, canManageStaffNotes: true,
        }
      : {
          mode: "staff",
          employeeId: employee!.id,
          employeeName: employee!.name,
          canAdmin: employee!.canAdmin,
          canManageLeave: employee!.canManageLeave,
          canManageEvents: employee!.canManageEvents,
          canManageCerts: employee!.canManageCerts,
          canManagePayroll: employee!.canManagePayroll,
          canManageStaffNotes: employee!.canManageStaffNotes,
        }
  );

  // Short (old 4-digit) PINs still work, but the app asks the person to pick
  // a new 6-digit one straight after logging in.
  const pinNeedsUpdate = !isSuper && !!data && String(data.pin ?? "").length < 6;

  return NextResponse.json({ ok: true, isSuper, employee, token, pinNeedsUpdate });
}
