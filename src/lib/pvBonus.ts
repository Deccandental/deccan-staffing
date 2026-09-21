import { supabase } from "./supabase";

export interface PvBonusQuarter {
  employeeId: number;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  totalIncome: number;
  notes: string;
  updatedAt?: string;
}

function fromRow(row: any): PvBonusQuarter {
  return {
    employeeId: row.employee_id, year: row.year, quarter: row.quarter,
    totalIncome: row.total_income ?? 0, notes: row.notes ?? "", updatedAt: row.updated_at,
  };
}

export async function loadPvBonusYear(employeeId: number, year: number): Promise<PvBonusQuarter[]> {
  const { data, error } = await supabase.from("pv_bonus_quarters").select("*")
    .eq("employee_id", employeeId).eq("year", year).order("quarter");
  if (error) { console.error("loadPvBonusYear error:", error); return []; }
  const byQuarter: Record<number, PvBonusQuarter> = {};
  for (const row of data ?? []) byQuarter[row.quarter] = fromRow(row);
  return ([1, 2, 3, 4] as const).map((q) => byQuarter[q] ?? { employeeId, year, quarter: q, totalIncome: 0, notes: "" });
}

// All quarters ever entered for an employee, oldest first — needed to walk
// the running balance forward correctly across year boundaries.
export async function loadAllPvBonusQuarters(employeeId: number): Promise<PvBonusQuarter[]> {
  const { data, error } = await supabase.from("pv_bonus_quarters").select("*")
    .eq("employee_id", employeeId).order("year").order("quarter");
  if (error) { console.error("loadAllPvBonusQuarters error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function savePvBonusQuarter(q: PvBonusQuarter): Promise<void> {
  const { error } = await supabase.from("pv_bonus_quarters").upsert({
    employee_id: q.employeeId, year: q.year, quarter: q.quarter,
    total_income: q.totalIncome, notes: q.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,year,quarter" });
  if (error) console.error("savePvBonusQuarter error:", error);
}

// ---------------- Gusto Payroll entries ----------------
// One row per pay period, entered as payroll runs — summed per quarter (by
// pay_period_start falling inside that quarter's date range) to get the
// quarter's "Gusto Payroll" figure.

export interface PvBonusPayrollEntry {
  id: string;
  employeeId: number;
  payPeriodStart: string;
  payPeriodEnd: string;
  amount: number;
  notes: string;
  createdAt: string;
}

function fromPayrollEntryRow(row: any): PvBonusPayrollEntry {
  return {
    id: row.id, employeeId: row.employee_id, payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end, amount: row.amount ?? 0, notes: row.notes ?? "", createdAt: row.created_at,
  };
}

export async function loadPvBonusPayrollEntries(employeeId: number): Promise<PvBonusPayrollEntry[]> {
  const { data, error } = await supabase.from("pv_bonus_payroll_entries").select("*")
    .eq("employee_id", employeeId).order("pay_period_start", { ascending: false });
  if (error) { console.error("loadPvBonusPayrollEntries error:", error); return []; }
  return (data ?? []).map(fromPayrollEntryRow);
}

export async function addPvBonusPayrollEntry(entry: Omit<PvBonusPayrollEntry, "id" | "createdAt">): Promise<PvBonusPayrollEntry | null> {
  const { data, error } = await supabase.from("pv_bonus_payroll_entries").insert({
    employee_id: entry.employeeId, pay_period_start: entry.payPeriodStart, pay_period_end: entry.payPeriodEnd,
    amount: entry.amount, notes: entry.notes,
  }).select().single();
  if (error) { console.error("addPvBonusPayrollEntry error:", error); return null; }
  return fromPayrollEntryRow(data);
}

export async function updatePvBonusPayrollEntry(id: string, updates: { payPeriodStart: string; payPeriodEnd: string; amount: number; notes: string }): Promise<PvBonusPayrollEntry | null> {
  const { data, error } = await supabase.from("pv_bonus_payroll_entries").update({
    pay_period_start: updates.payPeriodStart, pay_period_end: updates.payPeriodEnd, amount: updates.amount, notes: updates.notes,
  }).eq("id", id).select().single();
  if (error) { console.error("updatePvBonusPayrollEntry error:", error); return null; }
  return fromPayrollEntryRow(data);
}

export async function deletePvBonusPayrollEntry(id: string): Promise<void> {
  const { error } = await supabase.from("pv_bonus_payroll_entries").delete().eq("id", id);
  if (error) console.error("deletePvBonusPayrollEntry error:", error);
}

// ---------------- Bonus payments ----------------
// Actual payments made against a quarter's bonus. More than one per quarter
// is supported (e.g. a partial payment now, the remainder later) — both
// "Bonus Paid" and "Date Paid" are sums/lists over every payment tagged to
// that employee + year + quarter.

export interface PvBonusPayment {
  id: string;
  employeeId: number;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  datePaid: string;
  amount: number;
  notes: string;
  createdAt: string;
}

function fromPaymentRow(row: any): PvBonusPayment {
  return {
    id: row.id, employeeId: row.employee_id, year: row.year, quarter: row.quarter,
    datePaid: row.date_paid, amount: row.amount ?? 0, notes: row.notes ?? "", createdAt: row.created_at,
  };
}

export async function loadPvBonusPayments(employeeId: number): Promise<PvBonusPayment[]> {
  const { data, error } = await supabase.from("pv_bonus_payments").select("*")
    .eq("employee_id", employeeId).order("date_paid", { ascending: false });
  if (error) { console.error("loadPvBonusPayments error:", error); return []; }
  return (data ?? []).map(fromPaymentRow);
}

export async function addPvBonusPayment(payment: Omit<PvBonusPayment, "id" | "createdAt">): Promise<PvBonusPayment | null> {
  const { data, error } = await supabase.from("pv_bonus_payments").insert({
    employee_id: payment.employeeId, year: payment.year, quarter: payment.quarter,
    date_paid: payment.datePaid, amount: payment.amount, notes: payment.notes,
  }).select().single();
  if (error) { console.error("addPvBonusPayment error:", error); return null; }
  return fromPaymentRow(data);
}

export async function updatePvBonusPayment(id: string, updates: { datePaid: string; amount: number; notes: string }): Promise<PvBonusPayment | null> {
  const { data, error } = await supabase.from("pv_bonus_payments").update({
    date_paid: updates.datePaid, amount: updates.amount, notes: updates.notes,
  }).eq("id", id).select().single();
  if (error) { console.error("updatePvBonusPayment error:", error); return null; }
  return fromPaymentRow(data);
}

export async function deletePvBonusPayment(id: string): Promise<void> {
  const { error } = await supabase.from("pv_bonus_payments").delete().eq("id", id);
  if (error) console.error("deletePvBonusPayment error:", error);
}

// ---------------- Calculation ----------------

const QUARTER_MONTHS: Record<1 | 2 | 3 | 4, [number, number]> = { 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] };

function pad(n: number): string { return String(n).padStart(2, "0"); }

export function getPvQuarterDateRange(year: number, quarter: 1 | 2 | 3 | 4): { start: string; end: string } {
  const [startMonth, endMonth] = QUARTER_MONTHS[quarter];
  const lastDay = new Date(year, endMonth, 0).getDate();
  return { start: `${year}-${pad(startMonth)}-01`, end: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

export interface PvQuarterCalc {
  employeeId: number;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  totalIncome: number;
  thirtyPercent: number; // actually {percent}% of totalIncome
  gustoPayroll: number;
  bonus: number; // max(0, thirtyPercent - gustoPayroll)
  bonusPaid: number;
  datesPaid: string[];
  balance: number; // running: previous quarter's balance + this bonus - this bonusPaid
}

// Walks every quarter for an employee in chronological order (oldest first,
// across year boundaries) and computes each one, carrying the running
// balance forward exactly as described: an unpaid amount from Q1 shows up
// added into Q2's balance, and so on indefinitely.
export function computePvQuarterCalcs(
  quarters: PvBonusQuarter[], payrollEntries: PvBonusPayrollEntry[], payments: PvBonusPayment[], percent: number
): PvQuarterCalc[] {
  const sorted = [...quarters].sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  let runningBalance = 0;
  return sorted.map((q) => {
    const { start, end } = getPvQuarterDateRange(q.year, q.quarter);
    const gustoPayroll = payrollEntries
      .filter((e) => e.payPeriodStart >= start && e.payPeriodStart <= end)
      .reduce((sum, e) => sum + e.amount, 0);
    const thirtyPercent = q.totalIncome * (percent / 100);
    const bonus = Math.max(0, thirtyPercent - gustoPayroll);
    const quarterPayments = payments.filter((p) => p.year === q.year && p.quarter === q.quarter);
    const bonusPaid = quarterPayments.reduce((sum, p) => sum + p.amount, 0);
    const datesPaid = quarterPayments.map((p) => p.datePaid).sort();
    runningBalance = runningBalance + bonus - bonusPaid;
    return { employeeId: q.employeeId, year: q.year, quarter: q.quarter, totalIncome: q.totalIncome, thirtyPercent, gustoPayroll, bonus, bonusPaid, datesPaid, balance: runningBalance };
  });
}
