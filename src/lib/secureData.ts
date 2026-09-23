// Drop-in replacement for the `supabase` client, for the app's financial
// tables only.
//
// It deliberately mimics the small slice of the Supabase query-builder API
// those libraries already use — .select().eq().order(), .insert(),
// .upsert(), .update().eq(), .delete().eq() — so the call sites in
// pvBonus.ts, payrollStore.ts, cashflow.ts and friends barely change.
// Underneath, instead of talking to Supabase directly with the public anon
// key, it posts the described query to /api/secure-data, which verifies the
// caller's session and runs it server-side.
//
// Usage is identical to before:
//   const { data, error } = await secureData.from("payroll_entries")
//     .select("*").eq("person_key", key).order("pay_period_start");

const TOKEN_KEY = "dd_session_token";

export function storeSessionToken(token: string) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
}

export function clearSessionToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

export function getSessionToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

// A stored identity without a matching token is a stale login from before
// tokens existed (or an expired one) — the UI would look logged in while
// every data request silently failed. Gates use this to force a re-login.
export function hasSessionToken(): boolean {
  return getSessionToken() !== "";
}

interface Filter { column: string; op: string; value: unknown }

interface RequestSpec {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  filters: Filter[];
  order: { column: string; ascending?: boolean }[];
  limit?: number;
  single?: "single" | "maybeSingle";
  payload?: unknown;
  onConflict?: string;
}

async function execute(spec: RequestSpec): Promise<{ data: any; error: { message: string } | null }> {
  try {
    const res = await fetch("/api/secure-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() },
      body: JSON.stringify(spec),
    });
    const json = await res.json();
    if (res.status === 401) {
      // Session is missing or expired. Clear it so the next render shows the
      // login prompt, rather than leaving the user staring at blank numbers
      // with no explanation.
      clearSessionToken();
      if (typeof window !== "undefined") window.location.reload();
      return { data: null, error: { message: "Session expired — please log in again." } };
    }
    if (!res.ok) return { data: null, error: { message: json.error ?? "Request failed." } };
    return { data: json.data, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err?.message ?? "Network error." } };
  }
}

// Thenable builder: awaiting it runs the query, but .eq()/.order()/etc can
// be chained first — same ergonomics as the Supabase client.
class QueryBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private spec: RequestSpec;

  constructor(spec: RequestSpec) { this.spec = spec; }

  eq(column: string, value: unknown) { this.spec.filters.push({ column, op: "eq", value }); return this; }
  neq(column: string, value: unknown) { this.spec.filters.push({ column, op: "neq", value }); return this; }
  gt(column: string, value: unknown) { this.spec.filters.push({ column, op: "gt", value }); return this; }
  gte(column: string, value: unknown) { this.spec.filters.push({ column, op: "gte", value }); return this; }
  lt(column: string, value: unknown) { this.spec.filters.push({ column, op: "lt", value }); return this; }
  lte(column: string, value: unknown) { this.spec.filters.push({ column, op: "lte", value }); return this; }
  in(column: string, value: unknown[]) { this.spec.filters.push({ column, op: "in", value }); return this; }
  is(column: string, value: unknown) { this.spec.filters.push({ column, op: "is", value }); return this; }

  order(column: string, opts?: { ascending?: boolean }) {
    this.spec.order.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number) { this.spec.limit = n; return this; }

  // The Supabase client returns the inserted/updated rows from .select()
  // after a write; here the server already returns them, so this is a no-op
  // that just keeps the call sites identical.
  select(columns?: string) {
    if (this.spec.action === "select") this.spec.columns = columns ?? "*";
    return this;
  }

  async single() {
    this.spec.single = "single";
    return execute(this.spec);
  }

  async maybeSingle() {
    this.spec.single = "maybeSingle";
    return execute(this.spec);
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return execute(this.spec).then(onfulfilled, onrejected);
  }
}

function makeBuilder(table: string, action: RequestSpec["action"], extra: Partial<RequestSpec> = {}) {
  return new QueryBuilder({ table, action, filters: [], order: [], ...extra });
}

export const secureData = {
  from(table: string) {
    return {
      select: (columns?: string) => makeBuilder(table, "select", { columns: columns ?? "*" }),
      insert: (payload: unknown) => makeBuilder(table, "insert", { payload }),
      upsert: (payload: unknown, opts?: { onConflict?: string }) =>
        makeBuilder(table, "upsert", { payload, onConflict: opts?.onConflict }),
      update: (payload: unknown) => makeBuilder(table, "update", { payload }),
      delete: () => makeBuilder(table, "delete"),
    };
  },
};
