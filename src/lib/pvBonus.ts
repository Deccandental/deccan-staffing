import { supabase } from "./supabase";

export interface PvBonusQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  totalIncome: number;
  amountPaid: number;
  notes: string;
  updatedAt?: string;
}

function fromRow(row: any): PvBonusQuarter {
  return {
    year: row.year, quarter: row.quarter,
    totalIncome: row.total_income ?? 0, amountPaid: row.amount_paid ?? 0,
    notes: row.notes ?? "", updatedAt: row.updated_at,
  };
}

export async function loadPvBonusQuarter(year: number, quarter: number): Promise<PvBonusQuarter> {
  const { data, error } = await supabase.from("pv_bonus_quarters").select("*")
    .eq("year", year).eq("quarter", quarter).maybeSingle();
  if (error) console.error("loadPvBonusQuarter error:", error);
  if (!data) return { year, quarter: quarter as 1 | 2 | 3 | 4, totalIncome: 0, amountPaid: 0, notes: "" };
  return fromRow(data);
}

export async function savePvBonusQuarter(q: PvBonusQuarter): Promise<void> {
  const { error } = await supabase.from("pv_bonus_quarters").upsert({
    year: q.year, quarter: q.quarter, total_income: q.totalIncome, amount_paid: q.amountPaid, notes: q.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year,quarter" });
  if (error) console.error("savePvBonusQuarter error:", error);
}
