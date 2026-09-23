import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken, SessionPayload } from "@/lib/session";

// Server-side gateway for the app's financial tables.
//
// These tables (payroll, bonuses, compensation, cash flow) used to be read
// and written straight from the browser using the public anon key, which
// meant anyone holding that key could read or change them regardless of
// what the app's login screen showed. Every one of those calls now comes
// through here instead, where the caller's session token is verified and
// their permissions checked before anything touches the database.
//
// Once every client call goes through this route, RLS can be switched on
// for these tables with no policies at all — the browser no longer needs
// any direct access, and this route uses the service role key.

// Only these tables can be reached through this route. Anything not listed
// is rejected outright, so a tampered request can't pivot to, say, the
// staff table and read PINs.
const ALLOWED_TABLES = new Set([
  "payroll_entries",
  "pv_bonus_quarters", "pv_bonus_payroll_entries", "pv_bonus_payments",
  "ho_bonus_months",
  "growth_bonus_quarters", "growth_bonus_entries", "growth_bonus_payments",
  "hygiene_bonus_entries",
  "weekly_cash_reviews", "dental_monthly_entries", "dental_monthly_summary",
  "ar_aging_entries", "cash_accounts", "credit_cards", "card_charges",
  "recurring_bills", "bill_payments", "balance_checks",
  "card_statement_entries", "bank_statement_entries",
]);

// Tables holding an individual's own compensation. A staff member without
// payroll permission may read their own rows here (that's what their Staff
// Dashboard shows), but never anyone else's — enforced below by forcing an
// employee_id filter they can't override.
const OWN_ROW_READABLE = new Set([
  "pv_bonus_quarters", "pv_bonus_payroll_entries", "pv_bonus_payments",
  "ho_bonus_months", "growth_bonus_quarters", "growth_bonus_entries",
  "growth_bonus_payments", "hygiene_bonus_entries", "payroll_entries",
]);

interface SecureDataRequest {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  filters?: { column: string; op: string; value: unknown }[];
  order?: { column: string; ascending?: boolean }[];
  limit?: number;
  single?: "single" | "maybeSingle";
  payload?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
}

function canWrite(session: SessionPayload): boolean {
  return session.mode === "super" || session.canManagePayroll;
}

export async function POST(req: NextRequest) {
  const session = verifySessionToken(req.headers.get("x-session-token"));
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: SecureDataRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { table, action } = body;
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: "Unknown table." }, { status: 403 });
  }

  const privileged = canWrite(session);

  // Writes are payroll-permission only, always.
  if (action !== "select" && !privileged) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  // Reads: privileged users see everything. Everyone else may only read
  // their own rows, and only from the compensation tables.
  let forcedEmployeeId: number | null = null;
  if (action === "select" && !privileged) {
    if (!OWN_ROW_READABLE.has(table) || session.employeeId == null) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }
    forcedEmployeeId = session.employeeId;
  }

  try {
    if (action === "select") {
      let query = supabaseAdmin.from(table).select(body.columns ?? "*");
      for (const f of body.filters ?? []) {
        // Ignore any client-supplied employee_id filter when we're forcing
        // one — otherwise a staff user could ask for someone else's rows.
        if (forcedEmployeeId != null && f.column === "employee_id") continue;
        query = applyFilter(query, f);
      }
      if (forcedEmployeeId != null) query = query.eq("employee_id", forcedEmployeeId);
      for (const o of body.order ?? []) query = query.order(o.column, { ascending: o.ascending ?? true });
      if (body.limit != null) query = query.limit(body.limit);

      const { data, error } = body.single === "single"
        ? await query.single()
        : body.single === "maybeSingle"
        ? await query.maybeSingle()
        : await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (action === "insert") {
      const { data, error } = await supabaseAdmin.from(table).insert(body.payload as never).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (action === "upsert") {
      const { data, error } = await supabaseAdmin
        .from(table)
        .upsert(body.payload as never, body.onConflict ? { onConflict: body.onConflict } : undefined)
        .select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (action === "update") {
      let query = supabaseAdmin.from(table).update(body.payload as never);
      for (const f of body.filters ?? []) query = applyFilter(query, f);
      const { data, error } = await query.select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }

    if (action === "delete") {
      let query = supabaseAdmin.from(table).delete();
      for (const f of body.filters ?? []) query = applyFilter(query, f);
      const { error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    console.error("secure-data error:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}

// Only this fixed set of operators is supported — the column name and
// operator are never interpolated into raw SQL, they're passed to the
// Supabase client's own typed methods.
function applyFilter(query: any, f: { column: string; op: string; value: unknown }) {
  switch (f.op) {
    case "eq": return query.eq(f.column, f.value);
    case "neq": return query.neq(f.column, f.value);
    case "gt": return query.gt(f.column, f.value);
    case "gte": return query.gte(f.column, f.value);
    case "lt": return query.lt(f.column, f.value);
    case "lte": return query.lte(f.column, f.value);
    case "in": return query.in(f.column, f.value as unknown[]);
    case "is": return query.is(f.column, f.value as never);
    default: return query;
  }
}
