import { supabase } from "./supabase";

export interface PvBonusQuarter {
  employeeId: number;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  totalIncome: number;
  amountPaid: number;
  paid: boolean;
  notes: string;
  updatedAt?: string;
}

function fromRow(row: any): PvBonusQuarter {
  return {
    employeeId: row.employee_id, year: row.year, quarter: row.quarter,
    totalIncome: row.total_income ?? 0, amountPaid: row.amount_paid ?? 0,
    paid: row.paid ?? false, notes: row.notes ?? "", updatedAt: row.updated_at,
  };
}

export async function loadPvBonusYear(employeeId: number, year: number): Promise<PvBonusQuarter[]> {
  const { data, error } = await supabase.from("pv_bonus_quarters").select("*")
    .eq("employee_id", employeeId).eq("year", year).order("quarter");
  if (error) { console.error("loadPvBonusYear error:", error); return []; }
  const byQuarter: Record<number, PvBonusQuarter> = {};
  for (const row of data ?? []) byQuarter[row.quarter] = fromRow(row);
  return ([1, 2, 3, 4] as const).map((q) => byQuarter[q] ?? { employeeId, year, quarter: q, totalIncome: 0, amountPaid: 0, paid: false, notes: "" });
}

export async function savePvBonusQuarter(q: PvBonusQuarter): Promise<void> {
  const { error } = await supabase.from("pv_bonus_quarters").upsert({
    employee_id: q.employeeId, year: q.year, quarter: q.quarter,
    total_income: q.totalIncome, amount_paid: q.amountPaid, paid: q.paid, notes: q.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year,quarter" });
  if (error) console.error("savePvBonusQuarter error:", error);
}
