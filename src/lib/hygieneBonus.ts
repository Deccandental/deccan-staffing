import { supabase } from "./supabase";

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
export function getPayPeriodsInYear(year: number): { start: string; end: string; label: string }[] {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const periods: { start: string; end: string; label: string }[] = [];
  for (let month = 1; month <= 12; month++) {
    const lastDay = new Date(year, month, 0).getDate();
    periods.push({ start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-15`, label: `${MONTH_NAMES[month - 1]} 1–15` });
    periods.push({ start: `${year}-${pad(month)}-16`, end: `${year}-${pad(month)}-${pad(lastDay)}`, label: `${MONTH_NAMES[month - 1]} 16–${lastDay}` });
  }
  return periods;
}
