import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken } from "@/lib/session";

// Server-side gateway for CHANGING the staff table.
//
// The staff table holds every person's login PIN and their permission flags.
// It used to be writable straight from the browser with the public key, which
// meant anyone with that key could set a PIN or grant themselves admin and then
// log in. Every staff write now comes through here, where the caller's session
// is verified and their permission checked before anything touches the table.
// Once everything uses this route, the public key's write access to the table
// can be removed (see staff_lockdown_step2_writes.sql).

// What a caller gets back after adding someone: the same safe columns the app
// loads normally. The PIN is never returned.
const SAFE_COLUMNS =
  "id, name, role, specialty, color, skills, email, can_admin, can_manage_leave, can_manage_events, can_manage_certs, can_manage_payroll, pto_balance_hours, sick_balance_hours, exclude_from_payroll, remote_days, hire_date, growth_bonus_eligible, growth_bonus_multiplier, pv_bonus_eligible, hygiene_bonus_eligible, net_production_bonus_percent, ho_bonus_eligible, exempt_from_policy_signing, exempt_from_checkin, employment_type, archived, default_schedule";

const BALANCE_COLUMNS = new Set(["pto_balance_hours", "sick_balance_hours"]);

function clean(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const out = { ...(payload as Record<string, unknown>) };
  delete out.id; // an id is never taken from the body of an insert/update payload
  return out;
}

export async function POST(req: NextRequest) {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Malformed request." }, { status: 400 }); }

  const isAdmin = session.mode === "super" || session.canAdmin;
  const canBalances = isAdmin || session.canManageLeave || session.canManagePayroll;
  const id = Number(body.id);

  try {
    switch (body.action) {
      case "insert": {
        if (!isAdmin) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        const payload = clean(body.payload);
        if (!payload) return NextResponse.json({ error: "Bad payload." }, { status: 400 });
        const { data, error } = await supabaseAdmin.from("staff").insert(payload as never).select(SAFE_COLUMNS).single();
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data });
      }
      case "update": {
        if (!isAdmin || !Number.isFinite(id)) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        const payload = clean(body.payload);
        if (!payload) return NextResponse.json({ error: "Bad payload." }, { status: 400 });
        const { error } = await supabaseAdmin.from("staff").update(payload as never).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data: null });
      }
      case "setArchived": {
        if (!isAdmin || !Number.isFinite(id)) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        const { error } = await supabaseAdmin.from("staff").update({ archived: !!body.archived }).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data: null });
      }
      case "delete": {
        if (!isAdmin || !Number.isFinite(id)) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        const { error } = await supabaseAdmin.from("staff").delete().eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data: null });
      }
      case "adjustBalance":
      case "setBalance": {
        if (!canBalances || !Number.isFinite(id) || !BALANCE_COLUMNS.has(body.column)) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        let value: number;
        if (body.action === "setBalance") {
          value = Number(body.hours);
        } else {
          const { data, error: readError } = await supabaseAdmin.from("staff").select(body.column).eq("id", id).single();
          if (readError || !data) return NextResponse.json({ error: "Not found." }, { status: 404 });
          value = ((data as any)[body.column] ?? 0) + Number(body.delta);
        }
        if (!Number.isFinite(value)) return NextResponse.json({ error: "Bad number." }, { status: 400 });
        const { error } = await supabaseAdmin.from("staff").update({ [body.column]: value }).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data: null });
      }
      case "updateOwnProfile": {
        // A person may change only their own name and email. Nothing else can ride along.
        if (!Number.isFinite(id) || (!isAdmin && session.employeeId !== id)) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
        const name = String(body.name ?? "").trim();
        if (!name) return NextResponse.json({ error: "Name can't be empty." }, { status: 400 });
        const { error } = await supabaseAdmin.from("staff").update({ name, email: String(body.email ?? "").trim() }).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ data: null });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    console.error("staff-write error:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
