import { supabase } from "./supabase";
import { Employee } from "@/types/employee";
import { PayrollEntry } from "./payrollStore";

export interface GrowthBonusQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  bamThreshold: number;
  netProductionCurrent: number;
  netProductionPriorYear: number;
  updatedAt?: string;
}

export interface GrowthBonusPayment {
  id: string;
  employeeId: number;
  date: string;
  amount: number;
  notes: string;
  createdAt: string;
}

const QUARTER_MONTHS: Record<1 | 2 | 3 | 4, [number, number]> = {
  1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12],
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function getQuarterDateRange(year: number, quarter: 1 | 2 | 3 | 4): { start: string; end: string } {
  const [startMonth, endMonth] = QUARTER_MONTHS[quarter];
  const lastDay = new Date(year, endMonth, 0).getDate();
  return { start: `${year}-${pad(startMonth)}-01`, end: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

export function getCurrentQuarter(date: Date = new Date()): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const month = date.getMonth() + 1;
  const quarter = (Math.ceil(month / 3) as 1 | 2 | 3 | 4);
  return { year: date.getFullYear(), quarter };
}

function fromQuarterRow(row: any): GrowthBonusQuarter {
  return {
    year: row.year, quarter: row.quarter,
    bamThreshold: row.bam_threshold ?? 378000,
    netProductionCurrent: row.net_production_current ?? 0,
    netProductionPriorYear: row.net_production_prior_year ?? 0,
    updatedAt: row.updated_at,
  };
}

export async function loadGrowthBonusQuarter(year: number, quarter: number): Promise<GrowthBonusQuarter> {
  const { data, error } = await supabase.from("growth_bonus_quarters").select("*")
    .eq("year", year).eq("quarter", quarter).maybeSingle();
  if (error) console.error("loadGrowthBonusQuarter error:", error);
  if (!data) return { year, quarter: quarter as 1 | 2 | 3 | 4, bamThreshold: 378000, netProductionCurrent: 0, netProductionPriorYear: 0 };
  return fromQuarterRow(data);
}

export async function saveGrowthBonusQuarter(q: GrowthBonusQuarter): Promise<void> {
  const { error } = await supabase.from("growth_bonus_quarters").upsert({
    year: q.year, quarter: q.quarter, bam_threshold: q.bamThreshold,
    net_production_current: q.netProductionCurrent, net_production_prior_year: q.netProductionPriorYear,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year,quarter" });
  if (error) console.error("saveGrowthBonusQuarter error:", error);
}

export interface QuarterCalc {
  delta: number;
  growthPct: number;
  meetsBam: boolean;
  meetsGrowth: boolean;
  eligible: boolean;
  tierPct: number;
  bonusPool: number;
}

// Bonus only applies when production beats BAM AND grew at least 20% over
// the same quarter last year. Rate on the delta scales with how much growth:
// <30% -> 3%, 30-39% -> 4%, >=40% -> 5%.
export function computeQuarterCalc(q: GrowthBonusQuarter): QuarterCalc {
  const delta = q.netProductionCurrent - q.netProductionPriorYear;
  const growthPct = q.netProductionPriorYear > 0 ? delta / q.netProductionPriorYear : 0;
  const meetsBam = q.netProductionCurrent > q.bamThreshold;
  const meetsGrowth = growthPct >= 0.20;
  const eligible = meetsBam && meetsGrowth;
  const tierPct = growthPct >= 0.40 ? 0.05 : growthPct >= 0.30 ? 0.04 : 0.03;
  const bonusPool = eligible ? Math.round(delta * tierPct) : 0;
  return { delta, growthPct, meetsBam, meetsGrowth, eligible, tierPct, bonusPool };
}

// A person is eligible for a given quarter if they're opted into the
// program AND have been employed at least 5 months by the quarter's end.
export function isEligibleForQuarter(emp: Employee, quarterEnd: string): boolean {
  if (!emp.growthBonusEligible) return false;
  if (!emp.hireDate) return true;
  const hire = new Date(emp.hireDate + "T00:00:00");
  const end = new Date(quarterEnd + "T00:00:00");
  const monthsEmployed = (end.getFullYear() - hire.getFullYear()) * 12 + (end.getMonth() - hire.getMonth());
  return monthsEmployed >= 5;
}

// Days worked = hours actually worked (excludes PTO/sick/holiday/meeting
// hours, which are tracked separately) summed across every pay period whose
// start falls within the quarter, divided by 8.
export function computeDaysWorkedInQuarter(employeeId: number, quarterStart: string, quarterEnd: string, entries: PayrollEntry[]): number {
  const totalHours = entries
    .filter((e) => e.personKey === `staff:${employeeId}` && e.payPeriodStart >= quarterStart && e.payPeriodStart <= quarterEnd)
    .reduce((sum, e) => sum + e.hoursWorked, 0);
  return Math.round((totalHours / 8) * 10) / 10;
}

export interface EmployeeBonusRow {
  employee: Employee;
  days: number;
  multiplier: number;
  points: number;
  bonus: number;
}

export function splitBonusPool(bonusPool: number, rows: { employee: Employee; days: number }[]): EmployeeBonusRow[] {
  const withPoints = rows.map((r) => {
    const multiplier = r.employee.growthBonusMultiplier ?? 1;
    return { employee: r.employee, days: r.days, multiplier, points: Math.round(r.days * multiplier) };
  });
  const totalPoints = withPoints.reduce((sum, r) => sum + r.points, 0);
  return withPoints.map((r) => ({
    ...r,
    bonus: totalPoints > 0 ? Math.round(bonusPool * (r.points / totalPoints)) : 0,
  }));
}

function fromPaymentRow(row: any): GrowthBonusPayment {
  return { id: row.id, employeeId: row.employee_id, date: row.date, amount: row.amount ?? 0, notes: row.notes ?? "", createdAt: row.created_at };
}

export async function loadGrowthBonusPayments(employeeId?: number): Promise<GrowthBonusPayment[]> {
  let query = supabase.from("growth_bonus_payments").select("*").order("date", { ascending: false });
  if (employeeId != null) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) { console.error("loadGrowthBonusPayments error:", error); return []; }
  return (data ?? []).map(fromPaymentRow);
}

export async function addGrowthBonusPayment(payment: Omit<GrowthBonusPayment, "id" | "createdAt">): Promise<GrowthBonusPayment | null> {
  const { data, error } = await supabase.from("growth_bonus_payments").insert({
    employee_id: payment.employeeId, date: payment.date, amount: payment.amount, notes: payment.notes,
  }).select().single();
  if (error) { console.error("addGrowthBonusPayment error:", error); return null; }
  return fromPaymentRow(data);
}

export async function deleteGrowthBonusPayment(id: string): Promise<void> {
  const { error } = await supabase.from("growth_bonus_payments").delete().eq("id", id);
  if (error) console.error("deleteGrowthBonusPayment error:", error);
}
