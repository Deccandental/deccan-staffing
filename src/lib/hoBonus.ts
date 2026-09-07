import { supabase } from "./supabase";

export interface HoBonusMonth {
  year: number;
  month: number; // 1-12
  production: number;
  paid: number;
  notes: string;
  updatedAt?: string;
}

function fromRow(row: any): HoBonusMonth {
  return {
    year: row.year, month: row.month,
    production: row.production ?? 0, paid: row.paid ?? 0,
    notes: row.notes ?? "", updatedAt: row.updated_at,
  };
}

export async function loadHoBonusMonth(year: number, month: number): Promise<HoBonusMonth> {
  const { data, error } = await supabase.from("ho_bonus_months").select("*")
    .eq("year", year).eq("month", month).maybeSingle();
  if (error) console.error("loadHoBonusMonth error:", error);
  if (!data) return { year, month, production: 0, paid: 0, notes: "" };
  return fromRow(data);
}

export async function loadHoBonusMonths(year: number): Promise<HoBonusMonth[]> {
  const { data, error } = await supabase.from("ho_bonus_months").select("*").eq("year", year).order("month");
  if (error) { console.error("loadHoBonusMonths error:", error); return []; }
  const byMonth: Record<number, HoBonusMonth> = {};
  for (const row of data ?? []) byMonth[row.month] = fromRow(row);
  return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => byMonth[m] ?? { year, month: m, production: 0, paid: 0, notes: "" });
}

export async function saveHoBonusMonth(m: HoBonusMonth): Promise<void> {
  const { error } = await supabase.from("ho_bonus_months").upsert({
    year: m.year, month: m.month, production: m.production, paid: m.paid, notes: m.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year,month" });
  if (error) console.error("saveHoBonusMonth error:", error);
}
