import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionToken } from "@/lib/session";
import { TABLE_RULES, makeCtx, canRead, seesAll, canWriteAll, Filter, Action, TableRule, Ctx } from "@/lib/dataPolicy";

// Server-side gateway for every table the browser reads or writes.
//
// The database is locked to the public (anon) key, so the browser can't
// reach any table directly. Every query is described to this route instead,
// which verifies the caller's session, applies the table's rules from
// src/lib/dataPolicy.ts, and runs it with the service role key.

interface SecureDataRequest {
  table: string;
  action: Action;
  columns?: string;
  filters?: Filter[];
  order?: { column: string; ascending?: boolean }[];
  limit?: number;
  single?: "single" | "maybeSingle";
  payload?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "like"]);
const ACTIONS = new Set(["select", "insert", "update", "upsert", "delete"]);

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// Only plain column lists ("*" or "a, b, c"). No embedded tables, renames or
// casts: those could pull rows from tables the caller has no access to.
function parseColumns(columns: string | undefined): string | null {
  const c = (columns ?? "*").trim();
  if (c === "*") return "*";
  const parts = c.split(",").map((s) => s.trim());
  return parts.every((p) => IDENT.test(p)) ? parts.join(",") : null;
}

function strip(row: Record<string, unknown>, rule: TableRule, ctx: Ctx, all: boolean) {
  let r: Record<string, unknown> | null = row;
  for (const h of rule.hidden ?? []) if (h in r) { r = { ...r }; delete r[h]; }
  if (!all && rule.redact) r = rule.redact(r, ctx);
  return r;
}

function shape(data: unknown, rule: TableRule, ctx: Ctx, all: boolean) {
  if (Array.isArray(data)) return data.map((r) => strip(r, rule, ctx, all)).filter((r) => r != null);
  if (data && typeof data === "object") return strip(data as Record<string, unknown>, rule, ctx, all);
  return data;
}

async function run(q: any, single?: "single" | "maybeSingle") {
  return single === "single" ? q.single() : single === "maybeSingle" ? q.maybeSingle() : q;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-session-token");
  const session = token ? verifySessionToken(token) : null;
  // A token was sent but is invalid or expired: tell the browser so it can ask
  // the person to log in again, rather than quietly serving them public data.
  if (token && !session) return bad("Not authenticated.", 401);
  const ctx = makeCtx(session);

  let body: SecureDataRequest;
  try { body = await req.json(); } catch { return bad("Malformed request."); }

  const { table, action } = body;
  const rule = TABLE_RULES[table];
  if (!rule) return bad("Unknown table.", 403);
  if (!ACTIONS.has(action)) return bad("Unknown action.");

  const filters: Filter[] = Array.isArray(body.filters) ? body.filters : [];
  const order = Array.isArray(body.order) ? body.order : [];
  const all = seesAll(rule, ctx);

  // Validate every column the client names, and every operator.
  const restricted = new Set([...(rule.hidden ?? []), ...(all ? [] : rule.privateCols ?? [])]);
  for (const f of filters) {
    if (!f || typeof f.column !== "string" || !IDENT.test(f.column) || !OPS.has(f.op)) return bad("Unsupported filter.");
    if (restricted.has(f.column)) return bad("Not permitted.", 403);
  }
  for (const o of order) {
    if (!o || typeof o.column !== "string" || !IDENT.test(o.column) || restricted.has(o.column)) return bad("Unsupported order.");
  }
  if (body.onConflict != null && !(typeof body.onConflict === "string" && body.onConflict.split(",").every((c) => IDENT.test(c.trim())))) {
    return bad("Unsupported onConflict.");
  }

  try {
    if (action === "select") {
      if (!canRead(rule, ctx)) return bad(session ? "Not permitted." : "Not authenticated.", session ? 403 : 401);
      const columns = parseColumns(body.columns);
      if (!columns) return bad("Unsupported columns.");
      if (columns !== "*" && columns.split(",").some((c) => (rule.hidden ?? []).includes(c))) return bad("Not permitted.", 403);

      let query = supabaseAdmin.from(table).select(columns);
      let effective = filters;
      if (!all && rule.ownRead) {
        const own = rule.ownRead(ctx);
        if (!own) return bad("Not permitted.", 403);
        // Drop any client filter on the ownership column so it can't be widened, then force it.
        effective = [...filters.filter((f) => f.column !== own.column), own];
      }
      for (const f of effective) query = applyFilter(query, f);
      for (const o of order) query = query.order(o.column, { ascending: o.ascending ?? true });
      if (typeof body.limit === "number" && body.limit > 0) query = query.limit(Math.min(body.limit, 10000));

      const { data, error } = await run(query, body.single);
      if (error) return bad(error.message);
      return NextResponse.json({ data: shape(data, rule, ctx, all) });
    }

    // ---- writes ----
    if (!session) return bad("Not authenticated.", 401);
    let payload = body.payload;
    let effective = filters;
    if (!canWriteAll(rule, ctx)) {
      if (!rule.selfWrite) return bad("Not permitted.", 403);
      const verdict = await rule.selfWrite(action, payload, filters, ctx);
      if (!verdict.ok) return bad(verdict.error ?? "Not permitted.", 403);
      if (verdict.payload) payload = verdict.payload as typeof payload;
      effective = [...filters, ...(verdict.extraFilters ?? [])];
    }

    if (action === "insert" || action === "upsert" || action === "update") {
      const list = Array.isArray(payload) ? payload : [payload];
      if (!payload || list.length === 0 || list.some((r) => !r || typeof r !== "object")) return bad("Bad payload.");
      if (list.some((r) => Object.keys(r as object).some((k) => !IDENT.test(k) || (rule.hidden ?? []).includes(k)))) return bad("Bad payload.");
    }

    // Updates and deletes must name which rows. A missing filter would
    // otherwise change or wipe the whole table.
    if ((action === "update" || action === "delete") && effective.length === 0) return bad("Refusing to change every row.");

    if (action === "insert") {
      const { data, error } = await run(supabaseAdmin.from(table).insert(payload as never).select(), body.single);
      if (error) return bad(error.message);
      return NextResponse.json({ data: shape(data, rule, ctx, all) });
    }

    if (action === "upsert") {
      const q = supabaseAdmin.from(table).upsert(payload as never, { ...(body.onConflict ? { onConflict: body.onConflict } : {}), ignoreDuplicates: body.ignoreDuplicates === true }).select();
      const { data, error } = await run(q, body.single);
      if (error) return bad(error.message);
      return NextResponse.json({ data: shape(data, rule, ctx, all) });
    }

    if (action === "update") {
      let query = supabaseAdmin.from(table).update(payload as never);
      for (const f of effective) query = applyFilter(query, f);
      const { data, error } = await run(query.select(), body.single);
      if (error) return bad(error.message);
      return NextResponse.json({ data: shape(data, rule, ctx, all) });
    }

    // delete
    let query = supabaseAdmin.from(table).delete();
    for (const f of effective) query = applyFilter(query, f);
    const { error } = await query;
    if (error) return bad(error.message);
    return NextResponse.json({ data: null });
  } catch (err: any) {
    console.error("secure-data error:", err);
    return bad("Request failed.", 500);
  }
}

// Only this fixed set of operators is supported (checked above) — the column
// name and operator are never interpolated into raw SQL, they're passed to
// the Supabase client's own typed methods.
function applyFilter(query: any, f: Filter) {
  switch (f.op) {
    case "eq": return query.eq(f.column, f.value);
    case "neq": return query.neq(f.column, f.value);
    case "gt": return query.gt(f.column, f.value);
    case "gte": return query.gte(f.column, f.value);
    case "lt": return query.lt(f.column, f.value);
    case "lte": return query.lte(f.column, f.value);
    case "in": return query.in(f.column, Array.isArray(f.value) ? f.value : []);
    case "is": return query.is(f.column, f.value as never);
    case "like": return query.like(f.column, String(f.value));
    default: throw new Error(`Unsupported filter op ${f.op}`);
  }
}
