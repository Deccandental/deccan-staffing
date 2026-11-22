// Server-only: who may read and change each database table.
//
// Every browser read and write now goes through /api/secure-data, which uses
// the service role key and consults the rules below. The database itself is
// locked to the public (anon) key, so these rules are the only way in.
//
// Each table names:
//   read      who may read it at all: "public" (no login needed, used by the
//             public calendar), "session" (anyone logged in), or a list of
//             permissions.
//   readAll   who sees every row and column. Everyone else who may read gets
//             rows passed through `redact` (which can strip columns or drop
//             the row), and, with `ownRead`, only their own rows.
//   write     permissions that may insert/update/upsert/delete freely.
//   selfWrite optional check for people without `write`: it may allow the
//             change for their own rows, adding filters the client can't
//             remove, or reject it.
//   hidden    columns nobody can read, filter or sort on through this route.
//   privateCols  columns that callers without readAll may not filter/sort on.
import { SessionPayload } from "./session";

export type Perm = "admin" | "leaveManage" | "events" | "certs" | "payroll" | "staffNotes";

export interface Filter { column: string; op: string; value: unknown }
export type Action = "select" | "insert" | "update" | "upsert" | "delete";
type Row = Record<string, unknown>;

export interface Ctx {
  session: SessionPayload | null;
  self: number | null; // the caller's employee id, if they are a staff login
  has: (p: Perm) => boolean;
}

export type SelfWriteResult =
  | { ok: true; extraFilters?: Filter[]; payload?: Row | Row[] }
  | { ok: false; error?: string };

export interface TableRule {
  read: "public" | "session" | Perm[];
  readAll?: Perm[] | "session";
  ownRead?: (ctx: Ctx) => Filter | null; // for non-readAll readers: only these rows
  redact?: (row: Row, ctx: Ctx) => Row | null;
  write: Perm[];
  selfWrite?: (action: Action, payload: Row | Row[] | undefined, filters: Filter[], ctx: Ctx) => Promise<SelfWriteResult> | SelfWriteResult;
  hidden?: string[];
  // Columns that callers without readAll may not filter or sort on (otherwise
  // a filter could reveal a value that redact strips from the result).
  privateCols?: string[];
}

export function makeCtx(session: SessionPayload | null): Ctx {
  const has = (p: Perm): boolean => {
    if (!session) return false;
    if (session.mode === "super") return true;
    if (session.mode === "cpa") return false;
    switch (p) {
      case "admin": return !!session.canAdmin;
      case "leaveManage": return !!session.canManageLeave;
      case "events": return !!session.canManageEvents;
      case "certs": return !!session.canManageCerts;
      case "payroll": return !!session.canManagePayroll;
      case "staffNotes": return !!session.canManageStaffNotes;
    }
  };
  return { session, self: session?.mode === "staff" ? session.employeeId ?? null : null, has };
}

// ---- helpers --------------------------------------------------------------

const pick = (row: Row, cols: string[]): Row => {
  const out: Row = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
};
const rows = (p: Row | Row[] | undefined): Row[] => (Array.isArray(p) ? p : p ? [p] : []);
const keysWithin = (p: Row | Row[] | undefined, allowed: string[]) =>
  rows(p).length > 0 && rows(p).every((r) => Object.keys(r).every((k) => allowed.includes(k)));
const eq = (column: string, value: unknown): Filter => ({ column, op: "eq", value });
const deny = (error = "Not permitted."): SelfWriteResult => ({ ok: false, error });

// Rows the caller creates must be theirs; updates may not move a row to someone else.
function ownedRows(column: string) {
  return (action: Action, payload: Row | Row[] | undefined, _f: Filter[], ctx: Ctx): SelfWriteResult => {
    if (ctx.self == null) return deny();
    if (action === "insert" || action === "upsert") {
      // No explicit ids: an upsert naming another row's id would overwrite it.
      if (rows(payload).some((r) => "id" in r)) return deny();
      return rows(payload).length > 0 && rows(payload).every((r) => r[column] === ctx.self) ? { ok: true } : deny();
    }
    if (action === "update" && rows(payload).some((r) => column in r && r[column] !== ctx.self)) return deny();
    return { ok: true, extraFilters: [eq(column, ctx.self)] };
  };
}

const ownRow = (column: string) => (ctx: Ctx): Filter | null => (ctx.self == null ? null : eq(column, ctx.self));

// Compensation tables: a staff member may read only their own rows.
const COMP: TableRule = { read: "session", readAll: ["payroll"], ownRead: ownRow("employee_id"), write: ["payroll"] };
// Practice finances: payroll permission only.
const FIN: TableRule = { read: ["payroll"], write: ["payroll"] };

const STAFF_PUBLIC = ["id", "name", "role", "specialty", "color", "skills", "default_schedule", "archived", "remote_days", "employment_type"];
const LEAVE_PUBLIC = ["id", "employee_id", "employee_name", "start_date", "end_date", "is_partial_day", "partial_hours", "status", "starts_midday", "ends_midday", "total_days", "submitted_at"];
const EVENT_PUBLIC = ["id", "date", "time", "end_time", "title", "mandatory", "invite_all", "invited_staff_ids"];
const TEMP_PUBLIC = ["id", "name", "role", "skills"];

// ---- the rules ------------------------------------------------------------

export const TABLE_RULES: Record<string, TableRule> = {
  // Scheduling: the public calendar shows these without a login.
  schedules: { read: "public", write: ["admin"] },
  holidays: { read: "public", write: ["admin"] },
  open_tuesdays: { read: "public", write: ["admin"] },
  dentist_prefs: { read: "public", write: ["admin"] },
  temp_assignments: { read: "public", write: ["admin"] },
  overrides: { read: "public", write: ["admin", "leaveManage"] },
  temps: { read: "public", readAll: ["admin", "payroll"], redact: (r) => pick(r, TEMP_PUBLIC), privateCols: ["phone", "email", "notes", "rating"], write: ["admin"] },
  events: { read: "public", readAll: "session", redact: (r) => pick(r, EVENT_PUBLIC), privateCols: ["description", "reminders_sent"], write: ["events"] },

  // Staff: readable for names and schedules; PINs never leave the server.
  // All writes go through /api/staff-write instead.
  staff: { read: "public", readAll: "session", redact: (r) => pick(r, STAFF_PUBLIC), privateCols: ["email", "pto_balance_hours", "sick_balance_hours", "hire_date"], write: [], hidden: ["pin"] },

  leave_requests: {
    read: "public",
    readAll: ["leaveManage", "payroll", "admin"],
    // Others see their own requests in full, and only dates/status of everyone else's.
    redact: (r, ctx) => (ctx.self != null && r.employee_id === ctx.self ? r : pick(r, LEAVE_PUBLIC)),
    privateCols: ["employee_email", "reason", "notes", "review_note", "paid_hours", "reviewed_at"],
    write: ["leaveManage"],
    selfWrite: (action, payload, _f, ctx) => {
      if (ctx.self == null) return deny();
      if (action === "insert") {
        return rows(payload).length === 1 && rows(payload).every((r) => r.employee_id === ctx.self && r.status === "pending") ? { ok: true } : deny();
      }
      if (action === "update") {
        // A person may only cancel their own pending request.
        if (!keysWithin(payload, ["status"]) || rows(payload)[0].status !== "cancelled") return deny();
        return { ok: true, extraFilters: [eq("employee_id", ctx.self), eq("status", "pending")] };
      }
      if (action === "delete") {
        return { ok: true, extraFilters: [eq("employee_id", ctx.self), { column: "status", op: "in", value: ["cancelled", "denied"] }] };
      }
      return deny();
    },
  },

  event_rsvps: { read: "session", write: ["events"], selfWrite: ownedRows("employee_id") },

  checkin_slots: {
    read: "session",
    write: ["admin"],
    selfWrite: (action, payload, _f, ctx) => {
      if (action !== "update" || ctx.self == null || rows(payload).length !== 1) return deny();
      const p = rows(payload)[0];
      // Claim an open slot for yourself…
      if (keysWithin(payload, ["claimed_by_employee_id", "claimed_by_name", "notes"]) && p.claimed_by_employee_id === ctx.self) {
        return { ok: true, payload: { ...p, claimed_by_name: ctx.session?.employeeName ?? p.claimed_by_name }, extraFilters: [{ column: "claimed_by_employee_id", op: "is", value: null }] };
      }
      // …or release your own claim.
      if (keysWithin(payload, ["claimed_by_employee_id", "claimed_by_name", "completed"]) && p.claimed_by_employee_id === null && p.completed !== true) {
        return { ok: true, extraFilters: [eq("claimed_by_employee_id", ctx.self)] };
      }
      return deny();
    },
  },

  staff_notes: {
    read: "session",
    readAll: ["staffNotes"],
    ownRead: ownRow("employee_id"),
    redact: (r) => { const { private_note: _p, ...rest } = r; return rest; },
    privateCols: ["private_note"],
    write: ["staffNotes"],
  },

  policy_documents: { read: "session", write: ["admin"] },
  policy_document_versions: { read: "session", write: ["admin"] },
  policy_requirements: { read: "session", write: ["admin"] },
  policy_reminders_sent: { read: "session", write: ["admin"] },
  policy_signatures: {
    read: "session",
    write: ["admin"],
    selfWrite: async (action, payload, filters, ctx) => {
      if (ctx.self == null) return deny();
      if (action === "insert") return ownedRows("employee_id")(action, payload, filters, ctx);
      // The document's designated countersigner may countersign.
      if (action === "update" && keysWithin(payload, ["countersigned_by_name", "countersignature_image", "countersigned_at"])) {
        const idFilter = filters.find((f) => f.column === "id" && f.op === "eq");
        if (!idFilter) return deny();
        const { supabaseAdmin } = await import("./supabaseAdmin");
        const { data: sig } = await supabaseAdmin.from("policy_signatures").select("requirement_id").eq("id", idFilter.value as string).maybeSingle();
        if (!sig) return deny();
        const { data: req } = await supabaseAdmin.from("policy_requirements").select("document_id").eq("id", sig.requirement_id).maybeSingle();
        if (!req) return deny();
        const { data: doc } = await supabaseAdmin.from("policy_documents").select("countersigner_employee_id").eq("id", req.document_id).maybeSingle();
        return doc?.countersigner_employee_id === ctx.self ? { ok: true } : deny();
      }
      return deny();
    },
  },

  wishlist_items: { read: "session", write: ["admin"], selfWrite: (a, p, f, ctx) => (a === "update" ? deny() : ownedRows("added_by_employee_id")(a, p, f, ctx)) },
  wishlist_votes: { read: "session", write: ["admin"], selfWrite: (a, p, f, ctx) => (a === "update" ? deny() : ownedRows("employee_id")(a, p, f, ctx)) },

  certifications: { read: "session", write: ["certs"], selfWrite: ownedRows("employee_id") },
  ce_course_entries: { read: "session", write: ["certs"], selfWrite: ownedRows("employee_id") },
  required_cert_types: { read: "session", write: ["certs"] },

  // Compensation (own rows readable by the person).
  payroll_entries: { ...COMP, ownRead: (ctx) => (ctx.self == null ? null : eq("person_key", `staff:${ctx.self}`)) },
  pv_bonus_quarters: COMP, pv_bonus_payroll_entries: COMP, pv_bonus_payments: COMP,
  ho_bonus_months: COMP, ho_bonus_payments: COMP,
  growth_bonus_quarters: COMP, growth_bonus_entries: COMP, growth_bonus_payments: COMP,
  hygiene_bonus_entries: COMP, bonus_carryover: COMP,

  // Practice finances.
  weekly_cash_reviews: FIN, dental_monthly_entries: FIN, dental_monthly_summary: FIN,
  ar_aging_entries: FIN, cash_accounts: FIN, credit_cards: FIN, card_charges: FIN,
  recurring_bills: FIN, bill_payments: FIN, balance_checks: FIN,
  card_statement_entries: FIN, bank_statement_entries: FIN,
  debts: FIN, debt_statement_entries: FIN,
  off_cycle_payments: COMP, // a person may see their own off-cycle payments (counted in their hygiene totals)
  production_goals: FIN, cashflow_settings: FIN,
  retirement_accruals: FIN, retirement_deposits: FIN,
};

export function canRead(rule: TableRule, ctx: Ctx): boolean {
  if (rule.read === "public") return true;
  if (!ctx.session || ctx.session.mode === "cpa") return false;
  if (rule.read === "session") return true;
  return rule.read.some(ctx.has);
}

export function seesAll(rule: TableRule, ctx: Ctx): boolean {
  if (!ctx.session || ctx.session.mode === "cpa") return false;
  if (rule.readAll === "session") return true;
  if (!rule.readAll) return rule.read === "public" || rule.read === "session" || rule.read.some(ctx.has);
  return rule.readAll.some(ctx.has);
}

export function canWriteAll(rule: TableRule, ctx: Ctx): boolean {
  if (!ctx.session || ctx.session.mode === "cpa") return false;
  return rule.write.some(ctx.has);
}
