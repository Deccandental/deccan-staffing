import { supabase } from "./supabase";

export interface HoBonusMonth {
  employeeId: number;
  year: number;
  month: number; // 1-12
  production: number;
  paid: number;
  notes: string;
  updatedAt?: string;
}

function fromRow(row: any): HoBonusMonth {
  return {
    employeeId: row.employee_id, year: row.year, month: row.month,
    production: row.production ?? 0, paid: row.paid ?? 0,
    notes: row.notes ?? "", updatedAt: row.updated_at,
  };
}

export async function saveHoBonusMonth(m: HoBonusMonth): Promise<void> {
  const { error } = await supabase.from("ho_bonus_months").upsert({
    employee_id: m.employeeId, year: m.year, month: m.month, production: m.production, paid: m.paid, notes: m.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,year,month" });
  if (error) console.error("saveHoBonusMonth error:", error);
}

// Her production is paid out the following month, so the "2026 payout year"
// table starts with December 2025 (paid out in Jan 2026) and runs through
// November 2026 (paid out in Dec 2026) — 12 months, shifted by one.
export async function loadHoBonusPayoutYear(employeeId: number, payoutYear: number): Promise<HoBonusMonth[]> {
  const [decResult, restResult] = await Promise.all([
    supabase.from("ho_bonus_months").select("*").eq("employee_id", employeeId).eq("year", payoutYear - 1).eq("month", 12).maybeSingle(),
    supabase.from("ho_bonus_months").select("*").eq("employee_id", employeeId).eq("year", payoutYear).lte("month", 11).order("month"),
  ]);
  if (decResult.error) console.error("loadHoBonusPayoutYear (dec) error:", decResult.error);
  if (restResult.error) console.error("loadHoBonusPayoutYear (rest) error:", restResult.error);
  const dec: HoBonusMonth = decResult.data ? fromRow(decResult.data) : { employeeId, year: payoutYear - 1, month: 12, production: 0, paid: 0, notes: "" };
  const byMonth: Record<number, HoBonusMonth> = {};
  for (const row of restResult.data ?? []) byMonth[row.month] = fromRow(row);
  const janToNov = Array.from({ length: 11 }, (_, i) => i + 1).map((m) => byMonth[m] ?? { employeeId, year: payoutYear, month: m, production: 0, paid: 0, notes: "" });
  return [dec, ...janToNov];
}

// ---------------- Dated payments ----------------
// The month row's `paid` column can only hold one figure, but two or three
// separate payments are sometimes made within a month. Payments therefore
// live here with their own dates, and a month's paid total is their sum.

export interface HoBonusPayment {
  id: string;
  employeeId: number;
  datePaid: string;
  amount: number;
  notes: string;
  sourceKey: string | null;
  createdAt: string;
}

function fromPaymentRow(row: any): HoBonusPayment {
  return {
    id: row.id, employeeId: row.employee_id, datePaid: row.date_paid,
    amount: row.amount ?? 0, notes: row.notes ?? "", sourceKey: row.source_key ?? null,
    createdAt: row.created_at,
  };
}

export async function loadHoBonusPayments(employeeId: number): Promise<HoBonusPayment[]> {
  const { data, error } = await supabase.from("ho_bonus_payments").select("*")
    .eq("employee_id", employeeId).order("date_paid", { ascending: false });
  if (error) { console.error("loadHoBonusPayments error:", error); return []; }
  return (data ?? []).map(fromPaymentRow);
}

export async function addHoBonusPayment(p: { employeeId: number; datePaid: string; amount: number; notes?: string }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("ho_bonus_payments").insert({
    employee_id: p.employeeId, date_paid: p.datePaid, amount: p.amount, notes: p.notes ?? "",
  });
  if (error) { console.error("addHoBonusPayment error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function updateHoBonusPayment(id: string, updates: { datePaid: string; amount: number; notes: string }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("ho_bonus_payments").update({
    date_paid: updates.datePaid, amount: updates.amount, notes: updates.notes,
  }).eq("id", id);
  if (error) { console.error("updateHoBonusPayment error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteHoBonusPayment(id: string): Promise<void> {
  const { error } = await supabase.from("ho_bonus_payments").delete().eq("id", id);
  if (error) console.error("deleteHoBonusPayment error:", error);
}

/** Total paid in a given calendar month, summed from the dated payments. */
export function paidInMonth(payments: HoBonusPayment[], year: number, month: number): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return payments.filter((p) => p.datePaid.startsWith(prefix)).reduce((sum, p) => sum + p.amount, 0);
}
