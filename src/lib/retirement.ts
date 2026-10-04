import { secureData as supabase } from "./secureData"; // financial data goes through the secure server gateway, not the public key

/**
 * 401k money the practice owes the plan: what each person's paychecks call for
 * (their own deferral and any employer match, typed in from payroll each pay
 * period) against what has actually been deposited into the plan. Deposits are
 * dated and kept separately, because they often cover several pay periods at
 * once. The difference is what is still owed.
 */

export interface RetirementAccrual {
  employeeId: number;
  payPeriodStart: string; // YYYY-MM-DD
  deferral: number;       // the employee's own deferral withheld that period
  match: number;          // employer match or contribution for that period
}

export interface RetirementDeposit {
  id: string;
  employeeId: number;
  datePaid: string;
  amount: number;
  note: string;
}

const accrualFrom = (r: any): RetirementAccrual => ({
  employeeId: r.employee_id, payPeriodStart: r.pay_period_start, deferral: r.deferral ?? 0, match: r.match ?? 0,
});
const depositFrom = (r: any): RetirementDeposit => ({
  id: r.id, employeeId: r.employee_id, datePaid: r.date_paid, amount: r.amount ?? 0, note: r.note ?? "",
});

export async function loadRetirementAccruals(employeeId: number, from: string, to: string): Promise<RetirementAccrual[]> {
  const { data, error } = await supabase.from("retirement_accruals").select("*").eq("employee_id", employeeId).gte("pay_period_start", from).lte("pay_period_start", to);
  if (error) { console.error("loadRetirementAccruals error:", error); return []; }
  return (data ?? []).map(accrualFrom);
}

export async function saveRetirementAccrual(a: RetirementAccrual): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("retirement_accruals").upsert(
    { employee_id: a.employeeId, pay_period_start: a.payPeriodStart, deferral: a.deferral, match: a.match },
    { onConflict: "employee_id,pay_period_start" },
  );
  if (error) { console.error("saveRetirementAccrual error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function loadRetirementDeposits(employeeId: number): Promise<RetirementDeposit[]> {
  const { data, error } = await supabase.from("retirement_deposits").select("*").eq("employee_id", employeeId).order("date_paid", { ascending: false });
  if (error) { console.error("loadRetirementDeposits error:", error); return []; }
  return (data ?? []).map(depositFrom);
}

export async function addRetirementDeposit(d: Omit<RetirementDeposit, "id">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("retirement_deposits").insert({ employee_id: d.employeeId, date_paid: d.datePaid, amount: d.amount, note: d.note });
  if (error) { console.error("addRetirementDeposit error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteRetirementDeposit(id: string): Promise<void> {
  const { error } = await supabase.from("retirement_deposits").delete().eq("id", id);
  if (error) console.error("deleteRetirementDeposit error:", error);
}

/** Everyone's accruals and deposits since a date, for the Cash Flow total. */
export async function loadAllRetirement(since: string): Promise<{ accruals: RetirementAccrual[]; deposits: RetirementDeposit[] }> {
  const [a, d] = await Promise.all([
    supabase.from("retirement_accruals").select("*").gte("pay_period_start", since),
    supabase.from("retirement_deposits").select("*").gte("date_paid", since),
  ]);
  if (a.error) console.error("loadAllRetirement accruals error:", a.error);
  if (d.error) console.error("loadAllRetirement deposits error:", d.error);
  return { accruals: (a.data ?? []).map(accrualFrom), deposits: (d.data ?? []).map(depositFrom) };
}
