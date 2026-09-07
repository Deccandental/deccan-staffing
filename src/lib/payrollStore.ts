import { supabase } from "./supabase";

export interface PayrollEntry {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  // "staff:<id>" or "temp:<id>" — a single key so one table can hold both
  // kinds of person without nullable foreign-key columns.
  personKey: string;
  personName: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  sickHours: number;
  paidHolidayHours: number;
  paidMeetingHours: number;
  bonusAmount: number;
  hygienePatientCount: number;
  notes: string;
  // Marked true when this person isn't being paid this period — keeps them
  // visible in the list (so the choice is remembered) without requiring
  // real numbers to be entered.
  skipped: boolean;
  updatedAt: string;
}

export type NewPayrollEntry = Omit<PayrollEntry, "id" | "updatedAt">;

function fromRow(row: any): PayrollEntry {
  return {
    id: row.id,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    personKey: row.person_key,
    personName: row.person_name,
    hoursWorked: row.hours_worked ?? 0,
    overtimeHours: row.overtime_hours ?? 0,
    ptoHours: row.pto_hours ?? 0,
    sickHours: row.sick_hours ?? 0,
    paidHolidayHours: row.paid_holiday_hours ?? 0,
    paidMeetingHours: row.paid_meeting_hours ?? 0,
    bonusAmount: row.bonus_amount ?? 0,
    hygienePatientCount: row.hygiene_patient_count ?? 0,
    notes: row.notes ?? "",
    skipped: row.skipped ?? false,
    updatedAt: row.updated_at,
  };
}

export async function loadPayrollEntries(payPeriodStart: string): Promise<PayrollEntry[]> {
  const { data, error } = await supabase.from("payroll_entries").select("*").eq("pay_period_start", payPeriodStart);
  if (error) { console.error("loadPayrollEntries error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function savePayrollEntry(entry: NewPayrollEntry): Promise<PayrollEntry | null> {
  const { data, error } = await supabase
    .from("payroll_entries")
    .upsert({
      pay_period_start: entry.payPeriodStart,
      pay_period_end: entry.payPeriodEnd,
      person_key: entry.personKey,
      person_name: entry.personName,
      hours_worked: entry.hoursWorked,
      overtime_hours: entry.overtimeHours,
      pto_hours: entry.ptoHours,
      sick_hours: entry.sickHours,
      paid_holiday_hours: entry.paidHolidayHours,
      paid_meeting_hours: entry.paidMeetingHours,
      bonus_amount: entry.bonusAmount,
      hygiene_patient_count: entry.hygienePatientCount,
      notes: entry.notes,
      skipped: entry.skipped,
      updated_at: new Date().toISOString(),
    }, { onConflict: "pay_period_start,person_key" })
    .select()
    .single();
  if (error) { console.error("savePayrollEntry error:", error); return null; }
  return fromRow(data);
}
