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

// Her production is paid out the following month, so the "2026 payout year"
// table starts with December 2025 (paid out in Jan 2026) and runs through
// November 2026 (paid out in Dec 2026) — 12 months, shifted by one.
export async function loadHoBonusPayoutYear(payoutYear: number): Promise<HoBonusMonth[]> {
  const [decResult, restResult] = await Promise.all([
    supabase.from("ho_bonus_months").select("*").eq("year", payoutYear - 1).eq("month", 12).maybeSingle(),
    supabase.from("ho_bonus_months").select("*").eq("year", payoutYear).lte("month", 11).order("month"),
  ]);
  if (decResult.error) console.error("loadHoBonusPayoutYear (dec) error:", decResult.error);
  if (restResult.error) console.error("loadHoBonusPayoutYear (rest) error:", restResult.error);
  const dec: HoBonusMonth = decResult.data ? fromRow(decResult.data) : { year: payoutYear - 1, month: 12, production: 0, paid: 0, notes: "" };
  const byMonth: Record<number, HoBonusMonth> = {};
  for (const row of restResult.data ?? []) byMonth[row.month] = fromRow(row);
  const janToNov = Array.from({ length: 11 }, (_, i) => i + 1).map((m) => byMonth[m] ?? { year: payoutYear, month: m, production: 0, paid: 0, notes: "" });
  return [dec, ...janToNov];
}

export async function saveHoBonusMonth(m: HoBonusMonth): Promise<void> {
  const { error } = await supabase.from("ho_bonus_months").upsert({
    year: m.year, month: m.month, production: m.production, paid: m.paid, notes: m.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year,month" });
  if (error) console.error("saveHoBonusMonth error:", error);
}
