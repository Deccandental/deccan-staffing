import { supabase } from "./supabase";
import { Employee } from "@/types/employee";

export const HYGIENE_BONUS_PER_PATIENT = 15;

export interface HygieneBonusEntry {
  employeeId: number;
  payPeriodStart: string;
  payPeriodEnd: string;
  patientCount: number; // manual override — if unset, falls back to the Payroll table's count
  amountPaid: number;
  updatedAt?: string;
}

function fromRow(row: any): HygieneBonusEntry {
  return {
    employeeId: row.employee_id, payPeriodStart: row.pay_period_start, payPeriodEnd: row.pay_period_end,
    patientCount: row.patient_count ?? 0, amountPaid: row.amount_paid ?? 0, updatedAt: row.updated_at,
  };
}

// Loads every saved override/payment row for one employee within a date range.
export async function loadHygieneBonusEntries(employeeId: number, startDate: string, endDate: string): Promise<HygieneBonusEntry[]> {
  const { data, error } = await supabase.from("hygiene_bonus_entries").select("*")
    .eq("employee_id", employeeId).gte("pay_period_start", startDate).lte("pay_period_start", endDate)
    .order("pay_period_start");
  if (error) { console.error("loadHygieneBonusEntries error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function saveHygieneBonusEntry(entry: HygieneBonusEntry): Promise<void> {
  const { error } = await supabase.from("hygiene_bonus_entries").upsert({
    employee_id: entry.employeeId, pay_period_start: entry.payPeriodStart, pay_period_end: entry.payPeriodEnd,
    patient_count: entry.patientCount, amount_paid: entry.amountPaid, updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,pay_period_start" });
  if (error) console.error("saveHygieneBonusEntry error:", error);
}

/** Every 1st–15th / 16th–end pay period within a calendar year, in order. */
/**
 * The usual pay date for a pay period: the 1st-15th is paid on the 20th of the
 * same month, the 16th-end on the 8th of the next. Pay dates are always a
 * weekday, so one that lands on a weekend moves back to the Friday before.
 * Holidays aren't accounted for.
 */
function payDateFor(year: number, month: number, firstHalf: boolean): string {
  const d = firstHalf ? new Date(year, month - 1, 20) : new Date(year, month, 8);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  else if (dow === 0) d.setDate(d.getDate() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Tue, Jan 20" */
export function formatPayDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function getPayPeriodsInYear(year: number): { start: string; end: string; label: string; payDate: string }[] {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const periods: { start: string; end: string; label: string; payDate: string }[] = [];
  for (let month = 1; month <= 12; month++) {
    const lastDay = new Date(year, month, 0).getDate();
    periods.push({ start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-15`, label: `${MONTH_NAMES[month - 1]} 1–15`, payDate: payDateFor(year, month, true) });
    periods.push({ start: `${year}-${pad(month)}-16`, end: `${year}-${pad(month)}-${pad(lastDay)}`, label: `${MONTH_NAMES[month - 1]} 16–${lastDay}`, payDate: payDateFor(year, month, false) });
  }
  return periods;
}

/**
 * Whether someone is in the hygiene bonus program: only people ticked
 * "Eligible for Hygiene Bonus" on the Staff page, the same opt-in as the other
 * bonus programs. Being a hygienist is not enough on its own.
 */
export function isHygieneBonusEligible(e: Pick<Employee, "hygieneBonusEligible">): boolean {
  return e.hygieneBonusEligible === true;
}
